
#encode in brain-life
project_id="59026ad0af44920021b9e0e2"

base="/mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/HCP3T/sub-105115/tracts_classification"

rm -f tmp/*.mat

#ln -sf $base/fe_structure_105115_STC_run01_500000_tensor__connNUM01_TRACTS.mat tmp/output.mat
#../../import.js \
#    --name "fe_structure HCP3T/sub-105115(tensor)" \
#    --desc "fe_structure output from HCP3T/sub-105115(tensor) 500000" \
#    --project_id $project_id --tag "encode" --tag "hcp3" --tag "stc" --type "neuro/afq_output" --subject 105115 tmp

ln -sf $base/fe_structure_105115_STC_run01_500000_SD_PROB_lmax10_connNUM01_TRACTS.mat tmp/output.mat
../../import.js \
    --name "fe_structure HCP3T/sub-105115(SD_PROB)" \
    --desc "fe_structure output from HCP3T/sub-105115(SD_PROB) 500000" \
    --project_id $project_id --tag "encode" --tag "hcp3" --tag "stc" -tag "lmax10"  --tag "sd_prob" --type "neuro/afq_output" --subject 105115 tmp
