
#o3d in soichi7
#project_id="58eeceaabb2e2e2bd70d4682"

#o3d in brain-life
project_id="58ef90c87446bb0021cd26d4"

for subject in 158035
do 
    echo $subject
    type="neuro/track_output"
    ../import.js \
        --name "Track output for $subject" \
        --desc "Track output for $subject" \
        --project_id $project_id --tag "o3d" --type $type --subject $subject \
        /mnt/auto/dc2/projects/o3d/o3d-workflow/tracking/$subject

done
