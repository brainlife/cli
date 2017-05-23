
#encode in brain-life
project_id="59026ad0af44920021b9e0e2"

mkdir -p tmp

for subject in sub-FP
do
    echo "prepping $subject"
    ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN/$subject/dwi/run01_fliprot_aligned_trilin.nii.gz tmp/dwi.nii.gz
    ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN/$subject/dwi/run01_fliprot_aligned_trilin.bvecs tmp/dwi.bvecs
    ln -sf /mnt/auto/dc2/projects/lifebid/code/ccaiafa/Caiafa_Pestilli_paper2015/Revision_Feb2017/demo_datasets/STN/$subject/dwi/run01_fliprot_aligned_trilin.bvals tmp/dwi.bvals

    type="neuro/dwi"
    ../../import.js \
        --name "dwi STN/sub-FP" \
        --desc "dwi from STN/sub-FP" \
        --project_id $project_id --datatype_tag "single_shell" --tag "encode" --tag "stn" --tab "b2000" --type "neuro/dwi" --subject FP tmp
done
