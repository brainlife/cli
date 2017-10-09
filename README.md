# Brain-Life Command Line Interface

## Dependency

1. npm from https://www.npmjs.com/get-npm
2. brainlife account at https://brain-life.org/auth

## Installation

$ sudo npm install -g brainlife

## Login

Generate temporary access token used by brainlife command line.

```
$ bl login 
```

If successful, you will see the content of your JWT token displayed. 

## Import Dataset

Import data from local directory to brain-life

For each datatype, you must have correct file names for each files. I normally setup directories just for importing purpose with symlinks to the actual data files on my file system. If you have a lot of datasets to upload, you should create a bash script which will create such symlink directories.

Let say you have t1.nii.gz stored inside `/home/userid/mydata/12345/t1` directory. You can upload it by running something like following.

```
$ bl import \
    --desc "description of datset" \
    --type neuro/anat/t1w \
    --project_id xxxxxxxxxxxxxxxxxx \
    --subject 12345 \
    /home/userid/mydata/12345/t1
```

--type is where you specify the datatype that you are uploading. 

`neuro/anat/t1w` `neuro/anat/t2w` should have .. `t1.nii.gz`

`neuro/dwi` should have `dwi.nii.gz` `dwi.bvecs` `dwi.bvals`

`neuro/track` should have `track.tck

`neuro/freesurfer` should have `output` directory containing freesufer output directories (like mri, label, etc..)


--project_id can be found by going to https://brain-life.org/warehouse/#/projects and clicking on the project. The project id can be found as part of the URL.

Once imported, you should be able to find your datasets on brain-life.org. If your dataset is incorrectly uploaded, you can remove them at brain-life.org.

## Export Dataset

Export dataset by dataset ID

```
$ bl export \
    --id <datasetid>
```

It will create a directory on cwd and download and untar files for specified dataset

###  Other Options

Sometime you need to set datatype tags like `--datatype_tag "acpc_aligned" \`  Different datatype has different set of datatype tags. If you are not sure, please consult through github issues.

You can also set *user* tags like..  `--tag "xyz" --tag "anothertag" \`. User tags are used to help searching data. 


