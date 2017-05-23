
#o3d in soichi7
#project_id="58eeceaabb2e2e2bd70d4682"

#test in soichi7
project_id="58a79defcd07ba53cb8a3a04"

#o3d in brain-life
#project_id="58ef90c87446bb0021cd26d4"

#dir=/mnt/auto/dc2/projects/o3d/o3d-workflow/tracking/
dir=/mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets

for tract in "STN/sub-FP/tractography/run01_fliprot_aligned_trilin_csd_lmax10_wm_SD_PROB-NUM01-500000.tck"
do 
    echo $tract
    type="neuro/track"

    rm -rf test
    mkdir -p test 
    ln -s $dir/$tract test/track.tck

    ../import.js \
        --name "Track output for STN/FP" \
        --desc "Track output for STN/FP" \
        --project_id $project_id --tag "encode" --tag "csd" --tag "lmax10" --tag "sd_prob" --type $type --subject FP test
done
