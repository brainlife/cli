#!/usr/bin/env node

const fs = require('fs');
const commander = require('commander');
const archiver = require('archiver');
const FormData = require('form-data');
const config = require('./config');
const util = require('./util');

let program = new commander.Command();
program
    .requiredOption('-p, --project <project id>', 'project id to upload dataset to')
    .requiredOption('-d, --datatype <datatype>', 'datatype of uploaded dataset')
    .requiredOption('-s, --subject <subject>', '(metadata) subject of the uploaded dataset')
    .option('--datatype_tag <datatype tag>', 'add a datatype tag to the uploaded dataset', util.collect, [])
    .option('-e, --session <session>', '(metadata) session of the uploaded dataset')
    .option('-r, --run <run>', '(metadata) run of the uploaded dataset')
    .option('-t, --tag <tag>', 'add a tag to the uploaded dataset', util.collect, [])
    .option('-m, --meta <metadata file>', 'path for a sidecar .json file containing additional metadata', util.ensureArgFileJSONRead)
    .option('-n, --desc <description>', 'description of uploaded dataset')
    .option('-j, --json', 'output uploaded dataset information in json format')
    .allowUnknownOption(true)
    .exitOverride();

program.missingMandatoryOptionValue = (opt) => {
    throw new util.ArgError(opt.flags);
};

new Promise(async () => {
    try {
        
        program.parse();
        let options = program.opts ? program.opts() : program;

        util.http.authenticate();

        const datatype = await util.getDatatype(undefined, options.datatype);

        // Add datatype arguments
        program = program.allowUnknownOption(false);
        for (let file of datatype.files) {
            const isDir = !file.filename && file.dirname;
            const path = file.filename || file.dirname;
            const label = file.desc ?? file.id + (isDir ? ' directory' : ' file');

            program.option(`--${file.id} <${path}>`, label + file.required ? ' (required)' : '', util.ensureArgFileRead);
        }

        // Recheck arguments
        program.parse();
        options = program.opts ? program.opts() : program;

        // Fetch project
        const projects = await util.resolveProjects(undefined, options.project);
        if (projects.length == 0)
            throw new util.UserError(`Project "${options.project}" not found.`);
        if (projects.length > 1)
            throw new util.UserError(
                `There are ${projects.length} projects matching "${options.project}".` +
                `Please, specify one.`
            );
        const project = projects[0];

        let instanceName = `upload.${project.group_id}`;
        let instance = await util.findOrCreateInstance(undefined, instanceName, { project });

        console.error("Preparing to upload...");

        const taskRes = await util.http.post(`${config.api.amaretti}/task`, {
            instance_id: instance._id,
            name: instanceName,
            service: 'brainlife/app-noop',
            config: {},
        });
        const task = taskRes.data.task;
        await util.waitForFinish(
          undefined, task, !options.json
        );

        // Compress all the files into a tar.gz
        let archive = archiver('tar', { gzip: true });

        const output = fs.createWriteStream(`/tmp/bl-${task._id}.tar.gz`);
        archive.pipe(output);
        // @TODO for some reason, archiver and axios don't get together well
        //       so have to save to filesystem first and then upload

        for (let file of datatype.files) {
            const path = options[file.id];
            if (path === undefined) {
                continue;
            }
            if (file.filename) {
                archive.file(path, { name: file.filename });
            } else {
                archive.directory(path, file.dirname);
            }
        }

        await archive.finalize();

        console.error("Sending data...");

        const formData = new FormData({ autoDestroy: true });
        formData.append('file', fs.createReadStream(`/tmp/bl-${task._id}.tar.gz`));
        // formData.append('file', archive);
        const formHeaders = formData.getHeaders();

        await util.http.post(
            `${config.api.amaretti}/task/upload2/${task._id}`,
            formData,
            {
                params: {
                    p: 'upload/upload.tar.gz',
                    untar: true,
                },
                headers: formHeaders,
                maxBodyLength: Infinity,
            }
        );

        console.error("Data successfully sent to Brainlife. Finalizing upload...");

        const finalizeRes = await util.http.post(
            `${config.api.warehouse}/dataset/finalize-upload`,
            {
                task: task._id,
                datatype: datatype._id,
                subdir: "upload",
                fileids: datatype.files.map(f => f.id),
                datatype_tags: options.datatype_tag,
                meta: options.meta,
                tags: options.tags,
                desc: options.desc,
            }
        );

        // Wait for validation to finish
        if(finalizeRes.data.validator_task) {
            console.error("Validating...");

            const validatorTask = finalizeRes.data.validator_task;
            const { datasets } = await util.waitForFinish(
                undefined, validatorTask, !options.json,
            );
            
            console.error();
            console.error("Validator finished.");

            console.error(`Successfully uploaded. Data object id: ${datasets[0]._id}`);
            console.error(`https://${config.host}/project/${project._id}#object:${datasets[0]._id}`);

            if (options.json) {
                console.log(JSON.stringify(datasets[0]));
            }
        } else {
            console.error("No validator registered for this datatype. Skipping validation...");
            const { datasets } = await util.waitForArchivedDatasets(
                undefined, 1, task, !options.json
            );

            console.error(`Successfully uploaded. Data object id: ${datasets[0]._id}`);
            console.error(`https://${config.host}/project/${project._id}#object:${datasets[0]._id}`);

            if (options.json) {
                console.log(JSON.stringify(datasets[0]));
            }
        }
    } catch (error) {
        process.exit(
            util.handleAppError(program, error)
        );
    }

});
