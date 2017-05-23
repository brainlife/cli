
#o3d in soichi7
#project_id="58eeceaabb2e2e2bd70d4682"

#o3d in brain-life
#project_id="58ef90c87446bb0021cd26d4"

#encode in brain-life
project_id="59026ad0af44920021b9e0e2"

path=/mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN

type="neuro/dwi"
../import.js \
    --name "t1 STN/sub-FP" \
    --desc "anatomy STN/sub-FP" \
    --project_id $project_id --tag "encode" --tag "stn" --type "neuro/anat" --subject FP $path/sub-FP/anatomy
