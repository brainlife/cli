# bl aimport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bl aimport <folder> --project <id>` runs the aimport engine image on the user's computer, shows the plan in the terminal, gets approval, executes, checks the result with the brainlife datatype validators on the host, and uploads only the validated, de-identified output to the brainlife project.

**Architecture:** A new `bl-aimport.js` subcommand drives the engine's loopback HTTP API (ezbids `aimport/README.md`, "The workflow"). Helpers live in a new `aimport/` folder: `engine.js` (start/stop the container, API client, event stream), `plan-table.js` (terminal rendering), `validators.js` (host datatype validators), `upload.js` (objects, participants, project files). The BIDS upload core of `bl-bids-upload.js` moves into `bids-upload.js` so both commands share it (add, then switch; `bl bids upload` keeps its flags and output).

**Tech Stack:** Node (CommonJS, like the rest of `cli`), commander 5, axios, request-promise-native, readline-sync, archiver, node built-ins (`child_process`, `http`, `crypto`, `net`). Tests: mocha + `assert`, with local `http` stub servers. **No new dependencies.**

**Spec:** `~/git/brainlife/ezbids/docs/superpowers/specs/2026-11-23-aimport-design.md` (sections "Front ends", "Datatype validators", "Release", "Ancillary and metadata files").

## Global Constraints

- CLI shape (spec): `bl aimport <folder> --project <id> [--target bids|datatypes] [--ui]`. Without `--ui` it prints the plan as a table and asks for approval in the terminal. `--ui` is out of scope here (it needs the brainlife-lite page): accept the flag and exit 2 with `--ui needs the brainlife.io/aimport page, which is not available yet`.
- Extra flags (this plan's calls): `--work <dir>` (default `~/.cache/brainlife/aimport/<project id>/work`), `--keys <dir>` (default `~/.config/brainlife/aimport/keys`), `--deface pydeface|quickshear` (default `pydeface`), `--image <ref>` (default the pinned `ENGINE_IMAGE` constant in `aimport/engine.js`, `brainlife/aimport:dev` until maintainers publish a tag), `--yes` (approve without asking; for scripts), `--tag <tag>` (repeatable, added to every uploaded object, like `bl bids upload -t`), `--no-upload` (stop after validation).
- Engine contract: `docker run --rm --platform linux/amd64 -e AIMPORT_TOKEN [-e <model env>] -p 127.0.0.1:<port>:8765 -v <folder>:/data:ro -v <work>:/work -v <keys>:/keys <image> python -m aimport serve --input /data --work /work --keys /keys --host 0.0.0.0 --port 8765 --host-allow 127.0.0.1:<port> --host-allow localhost:<port>`. Publish on `127.0.0.1` only. The token is 32 random bytes hex from `crypto.randomBytes`, passed in the child's environment (`AIMPORT_TOKEN`), never on the command line. Model variables forwarded when set: `AIMPORT_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `DASHSCOPE_API_KEY` (by name only, `-e NAME`, so values never appear in the process list).
- Every request carries `Authorization: Bearer <token>` and goes to `http://127.0.0.1:<port>`.
- The keys folder must not be inside the work folder or the input folder (and vice versa); refuse with exit 2 before starting docker. Create both with mode 0700.
- Nothing is uploaded unless the final stage is `validated`. `invalid` and `failed` exit 1 with the engine's message; `<work>/output/bids.failed` is never uploaded.
- Upload reads only `<work>/output/bids`. Never upload `<work>/pre-deface`, `<work>/staged`, `sourcedata/`, or any `*.aimport-key.json`.
- Public interface rule (cli CLAUDE.md): `bl bids upload` keeps its flags, its output lines and its behavior.
- Tests never contact brainlife.io or docker: inject `spawn` and API base URLs; use local stub servers.
- Repo rules (workspace CLAUDE.md): branch `aimport-cli`, PRs against `master`, never publish to npm, docs updated in the same PR.

## Review Focus

1. Ctrl-C or any error after the container started → the container is stopped (`docker stop <name>`) and the engine's key lock released; test in Task 2 (`stop()` is called on every exit path of `run()`).
2. A project that already holds subjects/sessions from an earlier import → `existing_subjects`/`existing_sessions` are sent so IDs don't collide; test in Task 5.
3. The engine answers 409 (busy, stale plan, key locked) → the CLI prints the detail and exits 1, without a stack trace; test in Task 2.
4. Re-running after a successful upload → objects already in the project are skipped (same rule as `bl bids upload`: datatype, desc, subject, session, entities); test in Task 4.
5. A plan entry mapped to a draft brainlife datatype (not in the registry) → its object is skipped with a warning naming the datatype, and its files still go to project files; test in Task 4.

---

### Task 1: engine reports the output manifest (ezbids repo)

The CLI must know which output files belong to which plan entry, to apply the reviewer's brainlife mapping. Branch `aimport-7-status-manifest` stacked on `aimport-6-brainlife-edits-pr`, PR against `master`.

**Files:**
- Modify: `ezbids/aimport/src/aimport/server.py` (`GET /status`)
- Modify: `ezbids/aimport/README.md` (workflow step 7)
- Test: `ezbids/aimport/tests/test_server.py`

**Interfaces:**
- Produces: after `validated` or `invalid`, `GET /status` includes `manifest: {entry_id: [output-relative posix paths]}` (the same map `OUTPUT_STATE` holds; paths are inside the de-identified output, so they carry no identifiers).

- [ ] **Step 1:** Test `test_status_has_manifest_after_execute`: run the existing stubbed execute path, then `GET /status` → `status["manifest"][entry_id]` equals the files the writer reported; before execute, `"manifest" not in status`.
- [ ] **Step 2:** Run it: FAIL (`KeyError: 'manifest'`).
- [ ] **Step 3:** In `get_status`, when the stage is in `DONE` and the output state is complete, add `manifest` from `OUTPUT_STATE`.
- [ ] **Step 4:** Host suite passes: `cd aimport && uv run pytest -q -m "not docker and not docker_offline"`.
- [ ] **Step 5:** README step 7 mentions `manifest`. Commit `aimport: /status lists the output files of each plan entry after execute`.

### Task 2: engine runner and API client

**Files:**
- Create: `aimport/engine.js`
- Test: `test/aimport-engine.test.js`

**Interfaces:**
- Produces:
  - `ENGINE_IMAGE` (string constant), `MODEL_ENV` (array of the five names above)
  - `dockerArgs({image, folder, work, keys, port, name}) -> string[]` (exact contract above; container `--name` is `name`)
  - `checkFolders({folder, work, keys}) -> void` (throws `UsageError` on overlap)
  - `class Engine { constructor({base, token, spawn = child_process.spawn}); static async start(opts) -> Engine; async request(method, path, body?) -> object; async follow(onEvent) -> {stage, message}; async waitReady(timeoutMs = 120000); async stop() }`
  - `class EngineError extends Error { status }` (non-2xx answers; message = the engine's `detail`), `class UsageError extends Error`
- `start` picks a free port (`net.createServer().listen(0, '127.0.0.1')`), makes the token, spawns `docker` with `dockerArgs` and `env: {...process.env, AIMPORT_TOKEN: token}`, then `waitReady` polls `GET /status` every 500 ms.
- `follow` reads `GET /events` with `http.get` and parses `data: {...}` lines (ignore `:` keepalives); resolves on `planned`, `validated`, `invalid` or `failed`.

- [ ] **Step 1:** Tests:
  - `dockerArgs` contains `-p 127.0.0.1:<port>:8765`, `<folder>:/data:ro`, both `--host-allow` values, `-e AIMPORT_TOKEN`, and **no** element contains the token value.
  - `-e ANTHROPIC_API_KEY` present only when that variable is set (set/unset `process.env` in the test).
  - `checkFolders` throws for keys inside work, work inside keys, keys inside folder.
  - With a stub `http` server: `request` sends the bearer header; a 409 `{"detail":"busy: scanning"}` rejects with `EngineError` (`status` 409, message `busy: scanning`); `follow` returns `{stage:"planned"}` from a stream with a keepalive and two events.
  - `start` with a fake `spawn` (returns an EventEmitter with `kill`) against a stub server → `waitReady` resolves; `stop` runs `docker stop <name>` through the injected `spawn`.
- [ ] **Step 2:** Run `npx mocha test/aimport-engine.test.js`: FAIL (module missing).
- [ ] **Step 3:** Implement `aimport/engine.js`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `aimport: engine runner and API client`.

### Task 3: plan table

**Files:**
- Create: `aimport/plan-table.js`
- Test: `test/aimport-plan-table.test.js`, fixture `test/fixtures/aimport-plan.json` (a plan as `GET /plan` returns it: 4 entries — anat T1w ok, func bold ok, fmap magnitude1 excluded, unknown series — and 3 ancillary entries; no real identifiers)

**Interfaces:**
- Produces: `renderPlan(plan, {target}) -> string`, `renderResult(status) -> string`, `bidsName(entry) -> string` (`sub-<subject>[_ses-<session>]_<entities in schema order: task acq ce rec dir run echo part>_<suffix>`)
- Columns: `#`, BIDS name (`<datatype>/` + `bidsName`), brainlife datatype (target `datatypes` only), deface (`yes`/`no`/`opted out`), status (`ok`, `excluded: <reason>`, `unknown`), source and confidence (`agent 0.92`). `agent_note` printed under its row, indented. Then: dataset name, deface method, warnings (each on its own line, prefixed `! `), and ancillary entries (`path  action  flags`).
- `renderResult`: stage, output folder, validation error/warning counts and the first 20 issues.

- [ ] **Step 1:** Tests: `bidsName` for `{subject:"01",session:"1",entities:{run:"1",task:"rest"},suffix:"bold"}` is `sub-01_ses-1_task-rest_run-1_bold`; `renderPlan` output contains `anat/sub-01_ses-1_T1w`, `opted out` for an anat entry with `deface_opt_out`, `! ` before each warning, the ancillary paths; the brainlife column appears only for `target: "datatypes"`; no line is longer than 160 characters.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit `aimport: plan table for the terminal`.

### Task 4: shared BIDS upload with plan overrides

**Files:**
- Create: `bids-upload.js` (moved from `bl-bids-upload.js`: project-name lookup stays in the command; `submit_noop`, `do_upload`, the already-uploaded check, `updateParticipant`)
- Modify: `bl-bids-upload.js` (calls `bids-upload.js`; flags and printed lines unchanged)
- Create: `aimport/upload.js`
- Test: `test/aimport-upload.test.js`

**Interfaces:**
- Produces:
  - `bids-upload.js`: `async uploadDatasets(headers, project, datasets, {tags = [], api = config.api, log = console.log}) -> {uploaded: string[], skipped: string[]}`; `async updateParticipants(headers, project, bids, {api})`
  - `aimport/upload.js`: `applyPlan(bids, plan, manifest, datatypesByName, outputDir) -> {datasets, warnings}` and `projectFiles(outputDir, datasets) -> string[]` and `async uploadProjectFiles(headers, project, outputDir, files, {api, prefix = "bids/"})`
- `applyPlan`: a walker dataset whose files include any path in `manifest[entry.id]` (resolved against `outputDir`) takes `entry.brainlife_datatype` and `entry.brainlife_tags` when the entry has a `brainlife_datatype`; if that name is not in `datatypesByName` (a draft), drop the dataset and add the warning `<name> is not a registered brainlife datatype (draft): <bidsName> goes to project files only`. Excluded entries never appear (the engine did not write them).
- `projectFiles`: every file under `outputDir` not used by a kept dataset, excluding `participants.tsv`/`participants.json` (sent with `updateParticipants`); this carries `phenotype/`, `dataset_description.json`, `README`, `CHANGES`, `LICENSE`, `CITATION.cff`, sessions/scans tables and inherited sidecars. Refuse (throw) if any path contains `sourcedata/` or ends in `.aimport-key.json`.
- `uploadProjectFiles`: `POST {api.warehouse}/files/<project>/upload/presigned` with `{fileName, fileSize, contentType: "application/octet-stream", prefix}`, then `PUT` the bytes to `presignedUrl`.
- Also fix while moving: `bl-bids-upload.js` tests `bids.participant_json` but the walker sets `participants_json`.

- [ ] **Step 1:** Tests (stub warehouse/amaretti on a local server, `api` injected):
  - `uploadDatasets` skips a dataset whose `find` query returns `count: 1` and lists it in `skipped`.
  - `applyPlan` with a manifest mapping the T1w entry to `neuro/anat/t2w` changes that dataset's datatype; a draft name drops the dataset with the warning text above.
  - `projectFiles` includes `phenotype/moca.tsv` and `README`, excludes the object files and `participants.tsv`, and throws on a planted `sourcedata/x` file.
  - `uploadProjectFiles` posts `fileName: "phenotype/moca.tsv"` with prefix `bids/` and PUTs the bytes.
  - `bl bids upload` regression: the existing walker test data still produces the same dataset list through the new module (compare against a snapshot taken before the move — record the snapshot first, Global rule 4).
- [ ] **Step 2–4:** fail, implement, pass. Run the whole suite: `npm test` must show no new failures (the existing `test/test.js` needs a live login; run only `test/aimport-*.test.js` and the regression test without credentials and say so).
- [ ] **Step 5:** Commit `bids upload shared by bl bids upload and bl aimport; plan mapping and project files for aimport`.

### Task 5: host datatype validators

**Files:**
- Create: `aimport/validators.js`
- Test: `test/aimport-validators.test.js`

**Interfaces:**
- Produces: `async validateDataset(dataset, datatype, {spawn, cacheDir = ~/.cache/brainlife/aimport/validators}) -> {ok: boolean, skipped?: string, errors: string[], warnings: string[]}`; `parseMain(text) -> {image, command} | null`
- Spec rule: run locally from the datatype's `validator` and `validator_branch`; a failure blocks that object; no validator, or one that can't run locally → `skipped` with the reason, the object uploads with a warning and the server's validation decides.
- How: `git clone --depth 1 --branch <validator_branch> https://github.com/<validator>` into the cache (reuse if present, `git fetch` + reset otherwise); `parseMain` finds `singularity exec [-e] docker://<image> <command>` in `main`; anything else → skipped (`validator main is not a single singularity exec`). Write `config.json` in a temp copy of the clone: each `datatype.files[i].id` → `"/input/<filename or dirname>"`, plus `_inputs` with `datatype`, `meta`, `datatype_tags`; stage the dataset's files under a temp `input/` folder (copies); run `docker run --rm --platform linux/amd64 -v <tmp clone>:/validator -v <tmp input>:/input:ro -w /validator <image> <command>`; read `product.json` `errors`/`warnings`. Docker exits non-zero without `product.json` → `ok: false`, error `validator crashed: <last 5 lines of stderr>`.

- [ ] **Step 1:** Tests with a fake `spawn` that writes `product.json`: `parseMain` on `validator-neuro-anat`'s main returns `{image:"brainlife/dipy:1.1.1", command:"./run.py"}`; a `main` using `python run.py` alone → null; `config.json` maps `t1` to `/input/t1.nii.gz`; `errors: ["x"]` → `ok: false`; no `validator` on the datatype → `skipped`.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit `aimport: run brainlife datatype validators on the host`.

### Task 6: `bl aimport` command

**Files:**
- Create: `bl-aimport.js`
- Modify: `bl.js` (`.command('aimport', 'map a local DICOM/NIfTI folder to BIDS, de-identify, validate and upload it')`)
- Test: `test/aimport-command.test.js`

**Interfaces:**
- Consumes: everything above; `util.loadJwt`, `util.queryProjects`, `util.queryAllDatatypes`, `util.queryAllDatasets`/`queryDatasets` (project datasets' `meta.subject`, `meta.session`), `bids-walker.walk`.
- Produces: `async run(opts, deps) -> exitCode` (deps injectable: `Engine`, `prompt`, `upload`, `validate`, `log`), wired to commander in the same file.
- Flow: check flags and folders → resolve the project (must exist; aimport never creates one) → collect existing subjects/sessions → `Engine.start` → `POST /scan` `{project_id, existing_subjects, existing_sessions, target}` → `follow` → `failed` exits 1 → `GET /plan` → print `renderPlan` → prompt `Approve this plan? [y/N/e(dit)]` (`e` prints the engine README URL for `PATCH /plan` and the base URL+token so the person can edit with curl, then asks again; `--yes` skips) → `POST /approve {deface_method}` → `POST /execute` → `follow` → print `renderResult` → `invalid`/`failed` exit 1 → `GET /status` manifest → walker on `<work>/output/bids` → `applyPlan` → validators (any `ok:false` blocks that object; print why) → `uploadDatasets` + `updateParticipants` + `uploadProjectFiles` unless `--no-upload` → print the project URL → `stop()` in `finally`. SIGINT handler calls `stop()` and exits 130.
- `project_id` sent to the engine is the brainlife project `_id` (the key file is per project).

- [ ] **Step 1:** Tests with fake deps: approve path calls scan, approve with `deface_method: "quickshear"` when `--deface quickshear`, execute, upload; answering `n` exits 0 without approve or upload; `invalid` exits 1 without upload; `--no-upload` stops after validation; an `EngineError` 409 prints its message and exits 1; `stop` is called in every one of these cases; `--ui` exits 2 with the message in Global Constraints; a validator `ok:false` keeps that dataset out of the upload.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** Commit `bl aimport: scan, review, approve, execute, validate and upload from the terminal`.

### Task 7: docs and a manual end-to-end run

**Files:**
- Modify: `README.md` (cli): a `bl aimport` section (requirements: Docker; the engine image; model variables; folders; example session; what is and isn't uploaded).
- Modify: `~/git/brainlife/docs/docs/using_aimport.md` on branch `aimport-docs` (PR #158): Status note and a "Running it" section with the `bl aimport` command.
- Modify: `ezbids/aimport/README.md` "What's next" (Task 1's branch): point to `bl aimport`.

- [ ] **Step 1:** Manual run with the local image, no upload: build `brainlife/aimport:dev` if missing; fetch `dcm_qa_xa30` (`ezbids/aimport/tests/fixtures/fetch_dcm_qa.py`, planted); call `run({folder, project: "local-test", yes: true, upload: false, deface: "quickshear"}, deps)` from `test/aimport-manual.js` with the real `Engine` and fake project/dataset lookups (brainlife.io is never contacted), and record the result. Expected: stage `validated`, plan table printed, container gone afterwards (`docker ps` empty).
- [ ] **Step 2:** Record the run in `ezbids/aimport/tests/DATASETS.md` ("Used by": `bl aimport` manual run).
- [ ] **Step 3:** Commit docs in each repo.
