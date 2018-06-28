# Brain-Life Command Line Interface

## Dependency

1. npm from https://www.npmjs.com/get-npm
2. a brainlife account at https://brainlife.io/auth

## Installation

```
npm install -g brainlife
```

> For IU users, brainlife CLI is already installed on Karst / Carbonate / BigRed2. Please do `module load nodejs` to use it.

## Usage

All brainlife CLI commands obey the following structure:

```
bl <object> [method] [arguments]
```

The first thing we need to do is log in. After you've created your brainlife account, execute:

```
bl login
```

And type in your username and password when prompted. You will then be logged in.

```
$ bl login
username:  stevengeeky
password:
Successfully logged in!
```

We would like to accomplish the following workflow:

* Upload a dataset to brainlife
* Run a brainlife application with that dataset
* Download the result

In order to store a dataset, brainlife requires that you supply a project and datatype associated with it.

A datatype is used so that brainlife can guarantee that a certain type of dataset will always contain a given set of files. For example, the dataset we will be uploading–a t1 weighted image–must contain a file called 't1.nii.gz' in order to be successfully stored.

Before following along with this readme, you will need to make your own project on [brainlife.io](https://brainlife.io).

Have you made one? Then let's begin:

### Querying the Project

To search through the list of projects, we can use `bl project query`

My username is `stevengeeky`, so I'll query all of the projects I'm the admin of:

```
$ bl project query --admin stevengeeky
Id: 5afc2c8de68fc50028e90820
Name: Test Project
Admins: stevengeeky
Members: stevengeeky
Guests:
Access: Access: private (but listed for all users)
Description: test

(Returned 1 result)
```

Keep the id in mind for later. To specifically extrapolate the id from the query, install `jq` and run something similar to the following (using the previous query as an example):

```
$ bl project query --admin stevengeeky --json | jq -r '.[0]._id'
```

Which returns `5afc2c8de68fc50028e90820`.

`--json` instructs the CLI to output results in JSON format so that jq can parse the output.

Also, if you don't know what to run or how to run something, simply attach --help to the end of any command:

```
$ bl project query --help

  Usage: bl-project-query [options]

  Options:

    --id <id>           filter projects by id
    --query <query>   filter projects by name or description
    --admin <admin>     filter project by admins in it
    --member <members>  filter project by members in it
    --guest <guests>    filter project by guests in it
    --skip <skip>       number of results to skip
    --limit <limit>     maximum number of results to show
    --json              output data in json format
    -h, --help          output usage information
```

Now, we need a datatype for our dataset. Since I will be uploading a t1 weighted image, I'll query for the list of datatypes which might match what I want:

```
$ bl datatype query --query t1
Id: 58c33bcee13a50849b25879a
Name: neuro/anat/t1w
Description: T1 Weighted
Files: [(required) t1: t1.nii.gz]

(Returned 1 result)
```

The single result returned happens to be exactly what we want. This will be the datatype for our uploaded dataset.

Now, it's time to actually upload our data. I have a file named `t1.nii.gz` in a directory called `t1/`, and to upload it I need to supply a few things. Let's run `bl dataset upload --help` to figure out what those things are:

```
$ bl dataset upload --help

  Usage: bl-dataset-upload [options]

  Options:

    --directory <directory>          directory where your dataset is located
    --project <projectid>            project id to upload dataset to
    --datatype <datatype>            datatype of uploaded dataset
    --datatype_tags <datatype_tags>  datatype_tags of uploaded dataset
    --description <description>      description of uploaded dataset
    --subject <subject>              subject of uploaded dataset
    --session <session>              session of uploaded dataset
    --tags <tags>                    tags of uploaded dataset
    --meta <metadata>                name of file containing metadata (JSON) of uploaded dataset
    -h, --help                       output usage information
```

All that is required to upload a dataset is a directory to upload, a project id, and a datatype id. But you can also supply other options to provide additional information about it, such as applicable datatype tags, search tags, and which session and subject the data is from.

I will upload my dataset by using the following command, given the id of my project and datatype of my dataset:

```
$ bl dataset upload --t1 t1/t1.nii.gz    \
    --project 5afc2c8de68fc50028e90820   \
    --datatype 58c33bcee13a50849b25879a  \
    --description 'My t1 weighted image' \
    --subject 12345                      \
    --session 1                          \
    --tag "t1"                           \
    --tag "image"
```

Notice that I supplied `--tag` twice to add more than one search tag to my dataset. This works the same way with `datatype_tags`.

You can upload datasets by specifying a single directory containing all of the files for its associated datatype (using `--directory`). However, you can also specify the path for each individual file id, as is done above (`--t1 t1/t1.nii.gz`, where `--t1` is the file id and `t1/t1.nii.gz` is the file to upload).

```
Looking for /path/to/t1/t1.nii.gz
Waiting for upload task to be ready...
SERVICE: soichih/sca-service-noop    Brain Life
STATUS: Synchronously running service
(running since 13 seconds ago)
```

You can see the process update in real time. When it has finally finished it should output:

```
Dataset successfully uploaded!
Now registering dataset...
Finished dataset registration!
```

Now that we've uploaded a dataset, we can view it by querying the list of datasets:

```
$ bl dataset query --subject 12345

Id: 5b031990251f5200274d9cc4
Project: Test Project
Admins: stevengeeky
Members: stevengeeky
Guests:
Subject: 12345
Session: 1
Datatype: neuro/anat/t1w
Description: My t1 weighted image
Create Date: 5/21/2018, 3:10:08 PM (2 minutes ago)
Storage: jetstream
Status: stored

(Returned 1 result)
```

Now what's an app that we can run on a t1 image? Let's find one:

```
$ bl app query --input-datatype neuro/anat/t1w

...

Id: 5ac01066029f78002be2c481
Name: ACPC alignment via ART
Type: (t1: neuro/anat/t1w) -> (t1: neuro/anat/t1w<acpc_aligned>)
Description: This app uses the Automatic Registration Toolbox (ART) to perform ACPC alignment of the T1 image. See https://www.nitrc.org/projects/art/ for more information.

...

(Returned 6 results)
```

We can run this app to align our t1 image to the ACPC axial plane. It then outputs a new dataset with datatype `neuro/anat/t1w` and a datatype tag `acpc_aligned`, signifying that the data has been acpc aligned.

To run an app, we need the app's id, the ids of the input or inputs we want to supply it with, the id of the project to save it to, and a config JSON string for any additional input parameters required.

```
$ bl app run                                      \
    --id 5ac01066029f78002be2c481                 \
    --input t1:5b031990251f5200274d9cc4           \
    --project 5afc2c8de68fc50028e90820            \
    --config '{"reorient" : true, "crop" : true}'

Data Staging Task Created, PROCESS:
SERVICE: soichih/sca-product-raw
STATUS: Waiting to be processed by task handler
(running since 5 seconds ago)
```

After staging has completed, you should see the following output in the terminal:

```
Data Staging Task Created, PROCESS:
SERVICE: soichih/sca-product-raw
STATUS: Successfully finished
(538 ms ago)
ACPC alignment via ART Task for app 'ACPC alignment via ART' has begun.
```

You can wait for the app to finish by..

```
$ bl app wait --id 5b031dacc1b8f90044ad6c3b
```

Then, after the app has finished (and the dataset has been stored), you can download the resulting dataset just by supplying the resulting dataset id. You can get the resulting dataset id by querying the list of datasets (which will be sorted by date) and then running something like this:

```
$ bl dataset download --id 5afddb42251f5200274d9ca1
```

## Brain-Life JavaScript API

Here's an example of running an app with the brainlife javascript api:

```javascript
const fs = require('fs');
const brainlife = require('brainlife');

(async () => {

// log in
let jwt = await brainlife.login('stevengeeky', fs.readFileSync('my.password', 'ascii'));
let headers = { 'Authorization': 'Bearer ' + jwt };

// retrieve the correct datatype tag and project
let datatypes = await brainlife.queryDatatypes(headers, {
    search: 'neuro/anat/t1w'
});
let projects = await brainlife.queryProjects(headers, {
    search: 'Test Project'
});

let t1w = datatypes[0]._id;
let myProject = projects[0]._id;

// get a dataset and an app to run using that dataset
let datasets = await brainlife.queryDatasets(headers, {
    admin: 'stevengeeky',
    datatype: t1w,
    datatypeTags: [ '!acpc_aligned' ],
    project: myProject
});
let apps = await brainlife.queryApps(headers, {
    inputs: [ t1w ],
    outputs: [ t1w ]
});

let myDataset = datasets.reverse()[0]._id;
let appACPCAlignment = apps[0]._id;

// run the app
let appTask = await brainlife.runApp(headers, {
    app: appACPCAlignment,
    project: myProject,
    inputs: ["t1:" + myDataset]
});

// wait until it's finished
brainlife.waitForFinish(headers, appTask, process.stdout.isTTY, err => {
	if (err) throw err;
	console.log('Done!');
});

})();
```

## Bash Script Example

Here is a sample bash script to run app-pRF by first uploading datasets and submitting the app itself.

```bash
#!/bin/bash

# login (you only need to run this once every 30 days) 
bl login --ttl 30
# change --ttl (time-to-live) value to a desired days you'd like to keep your token alive 

# upload input

# Let's assume you have following files
# /somewhere/stimulus/stim.nii.gz
# /somewhere/task/bold.nii.gz

bl dataset upload --datatype 5afc7c555858d874a40c6dda --project 5afc2c8de68fc50028e90820 --subject "soichi1" --json /somewhere/stimulus 2>> upload.err | jq -r '._id' > stim.id
bl dataset upload --datatype 59b685a08e5d38b0b331ddc5 --project 5afc2c8de68fc50028e90820 --subject "soichi1" --datatype_tag "prf" --json /somewhere/task 2>> upload.err | jq -r '._id' > func.id

# For -d (datatype) ID, you can query it by `bl datatype query -q stimulus` or `bl datatype query -q func`
# For -p (project) ID, you can query project by `bl project query -q "project name"`

# If you have func/task sidecard file, you can store them in a json file (like "dataset.json") and load them to your dataset by adding `--meta dataset.json` to the upload command.

# Running the App!
bl app run --id 5b084f4d9f3e2c0028ab45e4 --project 5afc2c8de68fc50028e90820 --input tractogram_static:$(cat func.id) --input stimimage:$(cat stim.id) --config '{"frameperiod": "1.3"}' --json | jq -r '._id' > task.id

# You can query app by `bl app query -q "prf"`

# --config is where you pass JSON object containing config for your App. 

# Waiting for the App to finish (and archive output datasets)
bl app wait $(cat task.id)
if [ ! $? -eq 0 ];
   echo "app failed"
   exit 1
fi
echo "finished!"

# Download the ouput dataset
bl dataset download -i  
for id in $(bl dataset query --taskid $taskid --json | jq -r ".[]._id"); do
    echo "downloading dataset $id"
    bl dataset download $id
done

# Now you should see directories containing each output dataset with the dataset ID as a directory name.

```

## Bash script example for downloading all datasets of a certain datatype from a selected project and renaming the files by subject name

```bash
#!/bin/bash

#get the number of datasets you will download
#-p is project id
#-d is datatype id
count=$(bl dataset query -p 5a5506fc4f89380027a9a493 -d 59c3eae633fc1cf9ead71679 --json | jq -r '.[].meta.subject' | wc -l)

#for 0 to $count, get the dataset id and subject id for each subject
#download the dataset (in this case a 'raw' dataset)
#extract the specific files wanted, rename them and move them to the current directory
#remove the downloaded directory which is full of extraneous files

for ((i=0;i<$count;i++));
do
        id=$(bl dataset query -p 5a5506fc4f89380027a9a493 -d 59c3eae633fc1cf9ead71679 --json | jq --argjson arg $i -r '.[$arg]._id')
        subj=$(bl dataset query -p 5a5506fc4f89380027a9a493 -d 59c3eae633fc1cf9ead71679 --json | jq --argjson arg $i -r '.[$arg].meta.subject')
        echo "downloading dataset $subj"
        bl dataset download $id
        mv $id/volumes.json ./"${subj}_volumes.json"
        mv $id/volumes_icvproportion.json ./"${subj}_volumes_icvproportion.json"
        rm -rf $id
done
```
