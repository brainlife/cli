exports.api = {
	auth: "https://soichi7.ppa.iu.edu/api/auth",
	wf: "https://soichi7.ppa.iu.edu/api/wf",
	event_ws: "wss://soichi7.ppa.iu.edu/api/event",
	warehouse: "https://soichi7.ppa.iu.edu/api/warehouse",
}

exports.path = {
    jwt: process.env.HOME+"/.config/warehouse/.jwt",
}
