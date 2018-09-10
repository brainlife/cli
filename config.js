
exports.host = process.env.BLHOST || "brainlife.io";

exports.api = {
    auth: "https://"+exports.host+"/api/auth",
	wf: "https://"+exports.host+"/api/amaretti",
	warehouse: "https://"+exports.host+"/api/warehouse",

	event_ws: "wss://"+exports.host+"/api/event",
}

exports.path = {
    jwt: process.env.HOME+"/.config/" + exports.host + "/.jwt",
}
