
#encode in brain-life
project_id="59026ad0af44920021b9e0e2"

#ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN/sub-FP/fe_structures/fe_structure_FP_96dirs_b2000_1p5iso_STC_run01_tensor__connNUM01.mat tmp/output_fe.mat
#ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN/sub-FP/fe_structures/fe_structure_FP_96dirs_b2000_1p5iso_STC_run01_SD_PROB_lmax10_connNUM01.mat tmp/output_fe.mat

#ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/HCP7T/sub-108323/fe_structures/fe_structure_108323_STC_run01_tensor__connNUM01.mat /tmp/output_fe.mat
#../../import.js \
#    --name "fe_structure HCP7T/sub-108323 (tensor)" \
#    --desc "fe_structure output from HCP7T/sub-108323 (tensor)" \
#    --project_id $project_id --tag "encode" --tag "hcp7" --tag "stc" --tag "tensor" --type "neuro/life" --subject 108323 tmp

ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/HCP7T/sub-108323/fe_structures/fe_structure_105115_STC_run01_SD_PROB_lmax10_connNUM01.mat /tmp/output_fe.mat

../../import.js \
    --name "fe_structure HCP3T/sub-108323(SD_PROB)" \
    --desc "fe_structure output from HCP3T/sub-108323 (SD_PROB)" \
    --project_id $project_id --tag "encode" --tag "hcp7" --tag "lmax10"  --tag "sd_prob" --type "neuro/life" --subject 108323 tmp
