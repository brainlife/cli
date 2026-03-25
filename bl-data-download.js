#!/usr/bin/env node

//const request = require('request-promise-native');
const request = require('request'); //deprecated by axios..
const axios = require('axios'); //deprecated by axios..
const config = require('./config');
const fs = require('fs');
const path = require('path');
const tar = require('tar');
const mkdirp = require('mkdirp');
const commander = require('commander');
const util = require('./util');
const terminalOverwrite = require('terminal-overwrite');
const size = require('window-size');

commander
    .option('-i, --id <id>', 'download a data object with the given id')
    .option('-p, --project <projectid>', 'project id for S3 file download')
    .option('--path <s3path>', 'path within the project S3 prefix to download (file or folder/, use with --project)')
    .option('-d, --directory <directory>', 'local directory to download into')
    .option('-j, --json', 'output info about downloaded data object in json format')
    .parse(process.argv);

util.loadJwt().then(jwt => {
    let headers = { "Authorization": "Bearer " + jwt };

    // S3 mode: --project + --path
    if (commander.project && commander.path !== undefined) {
        downloadS3(headers, commander.project, commander.path, commander.directory, commander.json)
            .catch(err => {
                console.error("Download failed: " + (err.message || err));
                process.exit(1);
            });
        return;
    }

    if (commander.args.length > 0 && util.isValidObjectId(commander.args[0])) {
        commander.id = commander.id || commander.args[0];
        commander.args = commander.args.slice(1);
    }
    if (commander.args.length > 0) commander.directory = commander.directory || commander.args[0];
    downloadDataset(headers, commander.id, commander.directory, commander.json);
});

function downloadDataset(headers, id, dir, json) {
    if (!id) {
        console.error("No data object id specified. Use --id <id> or provide the id as a positional argument.");
        console.error("To download S3 project files, use --project and --path together.");
        process.exit(1);
    }
    dir = dir || id;
    if (!json) console.log("downloading data object to " + dir);

    //get dataset status first
    axios.get(config.api.warehouse+"/dataset", {
        headers, 
        params: {
            find: JSON.stringify({ _id: id }),
        }
    }).then(res=>{
        if(res.status != "200") {
            console.error("failed to find data object");
            console.dir(res.data);
            process.exit(1);
        }
        if(res.data.datasets.length != 1) {
            console.error("couldn't find the data object with id", id);
            process.exit(1);
        }
        if(res.data.datasets[0].status != "stored") {
            console.error("data object status is not 'stored': "+res.data.datasets[0].status);
            process.exit(1);
        }

        //proceed with downloading
        let contentLength = Infinity, loaded = 0;
        function showProgress() {
            if (process.stdout.isTTY && !json) {
                let percentage = loaded / contentLength;
                let progressBar = '', progressBarLength = size.width - 12;
                for (let i = 0; i < progressBarLength; i++) {
                    if (i / progressBarLength > percentage) progressBar += ' ';
                    else progressBar += '=';
                }
                if (!percentage) {
                    terminalOverwrite('Waiting..');
                } else {
                    terminalOverwrite(Math.round(percentage*100) + '% done [' + progressBar + ']');
                }
            }
        }

        let progress_int = setInterval(showProgress, 200);
        showProgress(0);
        fs.mkdir(dir, err => {
            //don't use callback for get(). it will buffer all output and it will run out of buffer (2G max)
            request.get({ url: config.api.warehouse + "/dataset/download/" + id, headers, encoding: null })
            .on('error', err=>{
                throw err;
            })
            .on('response', res=>{
                if(res.statusCode != 200) {
                    //res.body is always undefined because we are pipling it to tar..
                    console.error("failed to download");
                    process.exit(1);

                    //so to grab the real error message, let's just call the API again
                    axios.get(config.api.warehouse+"/dataset/download/"+id, {headers}).then(res=>{
                        console.log("Failed to download data object");
                        console.dir(res.toJSON());
                        process.exit(1);
                    });
                }
                contentLength = parseInt(res.headers['content-length']);
            })
            .on('data', chunk => {
                loaded += chunk.length;
            })
            .on('end', () => {
                if (process.stdout.isTTY) terminalOverwrite.done();
                clearInterval(progress_int);
            }).pipe(tar.x({ C: dir }));
        });
    }).catch(res=>{
        console.error("response:", res.response.data.message);
        process.exit(1);
    });
}

// ─── S3 download (via warehouse API) ────────────────────────────────────────

async function downloadS3(headers, projectInput, s3Path, dir, json) {
    let projectId;
    if (util.isValidObjectId(projectInput)) {
        projectId = projectInput;
    } else {
        let projects;
        try {
            projects = await util.resolveProjects(headers, projectInput) || [];
        } catch (err) {
            console.error("Failed to resolve project: " + (err.message || err));
            process.exit(1);
        }
        if (!projects || projects.length === 0) {
            console.error("No project found matching '" + projectInput + "' (or you don't have access)");
            process.exit(1);
        }
        if (projects.length > 1) {
            console.error("Multiple projects found matching '" + projectInput + "'. Please use a project ID.");
            process.exit(1);
        }
        projectId = projects[0]._id;
    }
    const cleanPath = s3Path.replace(/^\//, '');
    const isDirectory = cleanPath.endsWith('/') || cleanPath === '';

    try {
        if (isDirectory) {
            // Folder download — warehouse returns a tar stream
            const pathParts = cleanPath.replace(/\/$/, '').split('/').filter(Boolean);
            const defaultDir = pathParts.length > 0 ? pathParts[pathParts.length - 1] : projectId;
            const localRoot = (dir || defaultDir).replace(/\/+$/, '');

            if (!json) console.log("Downloading folder to " + localRoot + "/ (as tar archive)");
            await mkdirp(localRoot);

            // Build query string — Express reads `paths[]` as an array
            // Strip trailing slash from path before sending to the server
            const serverPath = cleanPath.replace(/\/$/, '');
            const qs = new URLSearchParams();
            qs.append('paths[]', serverPath);
            const url = config.api.warehouse + '/files/' + projectId + '/download-multiple?' + qs.toString();
            if (!json) console.log("Requesting: " + url);
            const res = await axios({ method: 'get', url, headers, responseType: 'stream', timeout: 300000 });

            if (res.status !== 200) {
                let errText = '';
                await new Promise(resolve => {
                    res.data.on('data', chunk => errText += chunk);
                    res.data.on('end', resolve);
                    res.data.on('error', resolve);
                });
                throw new Error("Server returned " + res.status + ": " + errText.slice(0, 300));
            }

            if (!json) console.log("Extracting to " + localRoot + "/");
            let fileCount = 0;
            await new Promise((resolve, reject) => {
                res.data
                    .on('error', reject)
                    .pipe(tar.x({ C: localRoot, onentry: () => { fileCount++; } }))
                    .on('finish', resolve)
                    .on('error', reject);
            });
            if (!json) {
                if (fileCount === 0) {
                    console.log("Warning: archive was empty — no files extracted.");
                } else {
                    console.log("Download complete. (" + fileCount + " file" + (fileCount === 1 ? "" : "s") + " extracted)");
                }
            }
        } else {
            // Single file download — warehouse streams it directly
            const filename = cleanPath.split('/').pop();
            const localDir = dir || '.';
            const localFilePath = path.join(localDir, filename);

            if (!json) console.log("Downloading " + filename + " to " + localFilePath);
            await mkdirp(localDir);

            const url = config.api.warehouse + '/files/' + projectId + '/download/' + cleanPath;
            const res = await axios({ method: 'get', url, headers, responseType: 'stream', timeout: 300000 });
            if (res.status !== 200) {
                let errText = '';
                await new Promise(resolve => {
                    res.data.on('data', chunk => errText += chunk);
                    res.data.on('end', resolve);
                    res.data.on('error', resolve);
                });
                throw new Error("Server returned " + res.status + ": " + errText.slice(0, 300));
            }
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(localFilePath);
                res.data.on('error', reject);
                res.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            if (!json) console.log("Download complete.");
        }
    } catch (err) {
        if (err.response && err.response.status === 400) {
            console.error("This project's files are not stored on S3.");
        } else if (err.response && err.response.status === 403) {
            console.error("Access denied. You may not have permission to access this project's files.");
        } else if (err.response && err.response.status === 404) {
            console.error("File not found: " + s3Path);
        } else {
            console.error("Download failed: " + (err.message || err));
        }
        process.exit(1);
    }
}
