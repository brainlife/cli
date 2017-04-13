# Brain-Life Command Line Interface

## Login

Generate temporary access token used by other command line.

```
$ bl login 
```

## Import Dataset

Import data from local directory to brain-life

```
$ bl import \
    --name "name of dataset" \
    --desc "description of datset" \
    --type "neuro/anat" \
    --datatype_tag "acpc_aligned" \
    --project_id "58eeceaabb2e2e2bd70d4..." \
    --tag "xyz" --tag "anothertag" \
    --subject "12345" \
    /data/dir/path
```


