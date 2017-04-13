
subject=158035

type="neuro/freesurfer"
../import.js \
    --name "Freesurfer output for $subject" \
    --desc "Freesurfer output for $subject" \
    --project_id "58eeceaabb2e2e2bd70d4682" --tag "o3d" --type $type --subject $subject \
    /mnt/auto/dc2/projects/o3d/o3d-workflow/freesurfer/$subject
