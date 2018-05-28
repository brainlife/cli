
const host = "test.brainlife.io";

exports.api = {
    auth: "https://"+host+"/api/auth",
	wf: "https://"+host+"/api/amaretti",
	warehouse: "https://"+host+"/api/warehouse",

	event_ws: "wss://"+host+"/api/event",
}

exports.path = {
    jwt: process.env.HOME+"/.config/" + host + "/.jwt",
}

