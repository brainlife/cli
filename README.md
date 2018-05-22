# Brain-Life Command Line Interface

## Dependency

1. npm from https://www.npmjs.com/get-npm
2. a brainlife account at https://brainlife.io/auth

## Installation

```
npm install -g brainlife
```

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

To start, let's look at the `bl dataset` command by running `bl dataset --help`:

```
$ bl dataset --help

  Usage: bl-dataset [options] [command]

  Options:

    -h, --help  output usage information

  Commands:

    query       query the list of all datasets
    download    download a dataset with the given id
    upload      upload a dataset
    help [cmd]  display help for [cmd]
```

If we want to upload a dataset, it seems we will need `bl dataset upload` to do that. Now we run `bl dataset upload --help`

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

So assume we have some data to upload (a t1 weighted image) called `t1.nii.gz` stored inside a directory called `t1/`

Currently, we are able to supply all of the above arguments, except for --project and --datatype. We can find those by querying them:

```
$ bl project query --help

... # see how to use the command

$ bl project query --admin stevengeeky
```

My query command returned one project, which I am the owner of:

```
Id: 5afc2c8de68fc50028e90820
Name: Test Project
Admins: stevengeeky
Members: stevengeeky
Guests:
Access: Access: private (but listed for all users)
Description: test
```

Take note of the id, we will need it for that dataset upload command. Now we need a datatype

```
$ bl datatype query --search t1
Id: 58c33bcee13a50849b25879a
Name: neuro/anat/t1w
Description: T1 Weighted
Files: [(required) t1: t1.nii.gz]

(Returned 1 result)
```

So we now have a datatype id as well. This means we can finally upload our dataset:

```
$ bl dataset upload --directory t1/      \
    --project 5afc2c8de68fc50028e90820   \
    --datatype 58c33bcee13a50849b25879a  \
    --description 'My t1 weighted image' \
    --subject 12345                      \
    --session 1                          \
    --tags "t1, image"

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
$ bl app query --input-type 'neuro/anat/t1'

...

Id: 5ac01066029f78002be2c481
Name: ACPC alignment via ART
Type: (neuro/anat/t1w) -> (neuro/anat/t1w<acpc_aligned>)
Description: This app uses the Automatic Registration Toolbox (ART) to perform ACPC alignment of the T1 image. See https://www.nitrc.org/projects/art/ for moreinformation.

...

(Returned 6 results)
```

We can run this app to align our t1 image to the ACPC axial plane. It then outputs a new dataset with datatype `neuro/anat/t1w` and a datatype tag `acpc_aligned`, signifying that the data has been acpc aligned.

To run an app, we need the app's id, the ids of the input or inputs we want to supply it with, the id of the project to save it to, and a config JSON string for any additional input parameters required.

```
$ bl app run
    --id 5ac01066029f78002be2c481                 \
    --inputs 5b031990251f5200274d9cc4             \
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
To monitor the app as it runs, please execute
bl app monitor --id 5b031dacc1b8f90044ad6c3b
```

You can monitor the app as it runs using the generated command:

```
$ bl app monitor --id 5b031dacc1b8f90044ad6c3b
```

Then, after the app has finished, you can download the resulting dataset just by supplying the dataset id:

```
$ bl dataset download --id 5afddb42251f5200274d9ca1
```

## Grab An ID From the CLI

If you want to quickly grab an id of a datatype/project/dataset/app, simply install `jq` (`npm install -g jq`) and then run something like this:

```
$ bl datatype query --limit 1 | jq -r '.[0]._id'
```