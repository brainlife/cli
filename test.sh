
subject=158035
#type="neuro/anat"
type="neuro/freesurfer"
./import.js \
    --name "ACPC aligned $subject" \
    --desc "ACPC aligned anatomy for $subject" \
    --datatype_tag "acpc_aligned" \
    --project_id "58eeceaabb2e2e2bd70d4682" --tag "o3d" --type $type --subject $subject \
    /mnt/auto/dc2/projects/o3d/o3d-workflow/freesurfer/$subject
