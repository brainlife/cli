
#o3d in soichi7
#project_id="58eeceaabb2e2e2bd70d4682"

#o3d in brain-life
#project_id="58ef90c87446bb0021cd26d4"
#testA in brain-life
#project_id="58e30424396448002114c4a9"
#white matter morph in brain-life
project_id="58efab6d7446bb0021cd26d5"

#all
#102311 108323 109123 131217 158035 200614 352738 573249 770352 910241

#for subject in 109123 131217 200614 352738 573249 770352 910241
#do
    path=/mnt/auto/dc2/projects/lifebid/wm_morphology/HCP_3T_test/133928/original_hcp_data/Diffusion
    ln -sf $path/data.nii.gz tmp/dwi.nii.gz
    ln -sf $path/bvecs tmp/dwi.bvecs
    ln -sf $path/bvals tmp/dwi.bvals

    ../import.js \
        --name "dwi $subject" \
        --desc "dwi $subject" \
        --project_id $project_id --tag "hcp" --type "neuro/dwi" --subject "133928" \
        tmp
#done
