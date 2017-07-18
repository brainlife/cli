# Brain-Life Command Line Interface

## Dependency

1. npm from https://www.npmjs.com/get-npm
2. brainlife account at https://brain-life.org/auth

## Installation

$ sudo npm install -g brainlife

## Login

Generate temporary access token used by brainlife command line.

```
$ brainlife login 
```

If successful, you will see the content of your JWT token displayed. 

## Import Dataset

Import data from local directory to brain-life

Let say you have t1.nii.gz stored inside `/home/userid/mydata/t1` directory. You can upload it by running something like following.

```
$ brainlife import \
    --desc "description of datset" \
    --type "neuro/anat" \
    --project_id "58eeceaabb2e2e2bd70d4..." \
    --subject "12345" \
    /home/userid/mydata/t1
```

project_id can be found by going to https://brain-life.org/warehouse/#/projects and clicking on the project. The project id can be found as part of the URL.

###  Other Options

Sometime you need to set datatype tags like `--datatype_tag "acpc_aligned" \`  Different datatype has different set of datatype tags. If you are not sure, please consult through github issues.

You can also set *user* tags like..  `--tag "xyz" --tag "anothertag" \`. User tags are used to help searching data. 


