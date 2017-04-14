
//const host = "soichi7.ppa.iu.edu";
const host = "brain-life.org";

exports.api = {
    auth: "https://"+host+"/api/auth",
	wf: "https://"+host+"/api/wf",
	event_ws: "wss://"+host+"/api/event",
	warehouse: "https://"+host+"/api/warehouse",
}

exports.path = {
    jwt: process.env.HOME+"/.config/warehouse/.jwt",
}

