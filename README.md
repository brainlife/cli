Please read [documentation](https://brainlife.io/docs/cli/install/) on brainlife.io

## bl aimport

`bl aimport` imports a folder of DICOM or NIfTI files on your own computer into a brainlife.io project. It runs the [aimport](https://brainlife.io/docs/using_aimport/) engine in Docker, converts the data to BIDS, removes identifying information, defaces the anatomical images, validates the result and only then uploads it. The raw data never leaves your computer.

Requirements:

- Node.js 18 or newer.
- Docker. The engine runs as a container from the image `brainlife/aimport:dev` (change it with `--image`). It is not published yet; build it from the [ezBIDS repository](https://github.com/brainlife/ezbids/tree/master/aimport) (`docker build --platform linux/amd64 -t brainlife/aimport:dev -f aimport/Dockerfile .`). From a checkout of ezBIDS `master` with submodules (`git submodule update --init`), build the base image first (`docker build --platform linux/amd64 -t ezbids-handler:local handler/`). An image built before the file manifest was added to the engine's `/status` (ezBIDS #179) stops with "the engine image is too old"; rebuild it. If the image is not on your computer, the first run pulls it (with Docker's progress shown) before the engine starts; the datatype validators are images too and are pulled on first use.
- On Colima (macOS), Docker can only mount folders under your home folder: the input, work and keys folders must all be under `$HOME`.
- Logged in (`bl login`) and an existing project; aimport never creates one.
- Optional, an AI model to help name the series. Without one the engine uses its built-in heuristics only. Set `AIMPORT_MODEL` and the key for your provider in your environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DASHSCOPE_API_KEY`, or `OLLAMA_BASE_URL` for a local model. They are passed to the container by name; the model only sees a de-identified summary of each series, never images or raw headers.

```
bl aimport <folder> --project <id> [options]
```

| Flag | Meaning |
| --- | --- |
| `-p, --project <id>` | project to upload to (required, it must exist) |
| `--target bids\|datatypes` | also show the brainlife datatype of each object in the plan (default `bids`) |
| `--ui` | review the plan on brainlife.io; not available yet (exits with 2) |
| `--work <dir>` | work folder (default `~/.cache/brainlife/aimport/<project id>/work`) |
| `--keys <dir>` | folder for the pseudonym key (default `~/.config/brainlife/aimport/keys`) |
| `--deface pydeface\|quickshear` | defacing method (default `pydeface`) |
| `--image <ref>` | engine image |
| `-y, --yes` | approve the plan without asking (for scripts) |
| `-t, --tag <tag>` | add a tag to every uploaded object (repeatable) |
| `--no-upload` | stop after validation; nothing is uploaded |

The work and keys folders are created private to you (mode 0700) and must not be inside each other or inside the input folder (symlinks are followed). An existing keys folder that other users can read is refused; fix it with `chmod 700 <dir>`. Folder paths must not contain `:` or `,`. Keep the keys folder safe and backed up: the pseudonym key in it is the only way back from the new subject IDs to the real people, it lets a later import of the same person reuse their ID, and it is never uploaded.

An example session:

```
$ bl aimport ~/scans/pilot --project 5f1c0a2b9d3e4a0012345678 --deface quickshear
Starting the aimport engine (brainlife/aimport:dev)...
  scanning: running ezBIDS
  planned: plan ready for review
#   BIDS name                deface  status
1   anat/sub-01_ses-1_T1w    yes     ok
2   dwi/sub-01_ses-1_dwi     no      ok
3   sub-01_ses-1_unknown     no      excluded: not an imaging acquisition
Approve this plan? [y/N/e(dit)] y
  executing: defacing the anatomical images
  executing: validating the BIDS dataset
  validated: no validation errors
...
Uploaded 2 object(s), skipped 0 already in the project, 6 project file(s)
https://brainlife.io/project/5f1c0a2b9d3e4a0012345678
```

Answer `e` to edit the plan through the engine's API: the command prints the engine's address and its session token (valid only while this engine runs) and an example `curl` call. Answer `N` to stop with nothing written or uploaded. The engine is stopped once the output is validated, before anything is uploaded, and on Ctrl-C (exit 130), `SIGTERM` (143) or `SIGHUP` (129).

What is uploaded, only when the final stage is `validated`:

- each image as a data object of its brainlife datatype (for example `neuro/anat/t1w`, `neuro/dwi`), after the datatype's own validator has accepted it on your computer. Objects already in the project are skipped, and an object that fails its validator is not uploaded.
- the participants table (`participants.tsv`/`.json`) into the project's participant information.
- the other metadata files (`dataset_description.json`, README, sidecars and the like) as project files under `bids/`.

What is never uploaded: the input folder, the pseudonym key (`*.aimport-key.json`), the images before defacing, `sourcedata/`, and a failed or invalid output (`bids.failed`). `invalid` and `failed` runs exit with 1 and the engine's message.

Copyright The University of Texas at Austin
