#!/bin/bash

# bl login
functasks=(5b0858869f3e2c0028ab45f5 5b0858869f3e2c0028ab45f5) # ...
stimuli=(5b0858669f3e2c0028ab45f4 5b0858669f3e2c0028ab45f4) # ...

myProject=`./bl.js project query --admin stevengeeky --search 'Test' --raw | jq -r '.[0]._id'` # this returns 5afc2c8de68fc50028e90820
type_t1w=`./bl.js datatype query --search neuro/anat/t1w --raw | jq -r '.[0]._id'` # returns 58c33bcee13a50849b25879a
app=`./bl.js app query --input-datatype neuro/func/task --input-datatype neuro/stimulus --raw | jq -r '.[0]._id'` # returns 5b084f4d9f3e2c0028ab45e4

echo $app

for (( i=0; i<${#functasks[@]}; i++ )); do
	stimulus=${stimuli[i]}
	functask=${functasks[i]}
	
	echo Running App Instance $((i+1))
	./bl.js app run --id $app --project $myProject --input "0:$functask" --input "1:$stimulus"
done
