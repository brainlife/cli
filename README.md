# Brain-Life Command Line Interface

## Dependency

npm from https://www.npmjs.com/get-npm

## Installation

$ sudo npm install -g brainlife

## Login

Generate temporary access token used by other command line.

```
$ brainlife login 
```

## Import Dataset

Import data from local directory to brain-life

```
$ brainlife import \
    --name "name of dataset" \
    --desc "description of datset" \
    --type "neuro/anat" \
    --datatype_tag "acpc_aligned" \
    --project_id "58eeceaabb2e2e2bd70d4..." \
    --tag "xyz" --tag "anothertag" \
    --subject "12345" \
    /data/dir/path
```


