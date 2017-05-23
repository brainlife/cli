
#o3d in soichi7
#project_id="58eeceaabb2e2e2bd70d4682"

#o3d in brain-life
project_id="58ef90c87446bb0021cd26d4"

b=2000

#all
#102311 108323 109123 131217 158035 200614 352738 573249 770352 910241

for subject in 109123 131217 200614 352738 573249 770352 910241
do
    echo "prepping $subject"
    ln -sf /mnt/auto/dc2/projects/lifebid/HCP7/$subject/diffusion_data/data_b$b.nii.gz tmp/dwi.nii.gz
    ln -sf /mnt/auto/dc2/projects/lifebid/HCP7/$subject/diffusion_data/data_b$b.bvecs tmp/dwi.bvecs
    ln -sf /mnt/auto/dc2/projects/lifebid/HCP7/$subject/diffusion_data/data_b$b.bvals tmp/dwi.bvals

    type="neuro/dwi"
    ../import.js \
        --name "dwi HCP7/$subject" \
        --desc "dwi(b$b) from HCP7/$subject" \
        --project_id $project_id --tag "o3d" --tag "hcp7" --tag "b$b" --type $type --subject $subject \
        tmp
done
