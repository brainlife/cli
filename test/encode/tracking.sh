
#encode in brain-life
project_id="59026ad0af44920021b9e0e2"

#dir=/mnt/auto/dc2/projects/o3d/o3d-workflow/tracking/
dir=/mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets

#for tract in "STN/sub-FP/tractography/run01_fliprot_aligned_trilin_csd_lmax10_wm_SD_PROB-NUM01-500000.tck"
#for tract in "STN/sub-FP/tractography/dwi_data_b2000_aligned_trilin_wm_tensor-NUM01-500000.tck"
    
#for tract in "HCP3T/sub-105115/tractography/dwi_data_b2000_aligned_trilin_wm_tensor-NUM01-500000.tck"
#for tract in "HCP3T/sub-105115/tractography/dwi_data_b2000_aligned_trilin_csd_lmax10_wm_SD_PROB-NUM01-500000.tck"

#for tract in "HCP7T/sub-108323/tractography/data_b2000_csd_lmax8_wm_SD_PROB-NUM01-500000.tck"
for tract in "HCP7T/sub-108323/tractography/data_b2000_wm_tensor-NUM01-500000.tck"
do 
    rm -rf test
    mkdir -p test 
    ln -s $dir/$tract test/track.tck

    ../../import.js \
        --name "Track output HCP7T/sub-108323(Tensor)" \
        --desc "Track output from HCP7T/sub-108323(Tensor) 500000" \
        --project_id $project_id --tag "encode" --tag "b2000" --tag "tensor" --tag "hcp7" --type "neuro/track" --subject 108323 test
done
