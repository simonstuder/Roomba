
const roomba = require('./roomba.js')

const Roomba = roomba.Roomba
const Plan = roomba.Plan
const TimedAction = roomba.TimedAction


var r = new Roomba({
	tcp_port: 8080
})

var shakePlan = new Plan([
	new TimedAction(function() {console.log("first action")},1),
	new TimedAction(function() {r.rh.full()},100),
	new TimedAction(function() {r.rh.drive(20,-1)},500),
	new TimedAction(function() {r.rh.drive(20,1)},1000),
	new TimedAction(function() {r.rh.drive(20,-1)},1500),
	new TimedAction(function() {r.rh.drive(20,1)},2000),
	new TimedAction(function() {r.rh.drive(20,-1)},2500),
	new TimedAction(function() {r.rh.drive(20,1)},3000),
	new TimedAction(function() {r.rh.drive(0,0)},3500),
	new TimedAction(function() {console.log("end of shake plan")},3600),
	//new TimedAction(function() {r.rh.safe()},7000),
	//new TimedAction(function() {r.rh.start()},7200),
])
r.plan.incorporatePlan(shakePlan)
shakePlan.onComplete["final"] = function() {
	console.log("shake plan done")
}

r.plan.onComplete["final"] = function() {
	console.log("all done")
}

const bumpPlan = new Plan([
	new TimedAction(function() {console.log("bump")},10),
	new TimedAction(function() {r.rh.drive(-50,0)},10),
	new TimedAction(function() {r.rh.drive(0,0)},400),
	//new TimedAction(function() {r.plan.removePlan(bumpPlan)},410),
])

//setInterval(function() {console.log(r.plan); console.log(shakePlan)},1000)

r.on('bump', function(v, sid) {
	if (v[0] || v[1]) { // bump
		console.log("bump event",v)
		r.sockets.writeToList('bumpListeners')
		//r.plan.incorporatePlan(bumpPlan)
	}
})
r.on('cliff', function(v, sid) {
	console.log("cliff",v, sid)
})

r.onConnected = function() {
	console.log("RoombaHardware connected")
	r.plan.start()
}

function sensorToServerFn(id, v) {
	//console.log("got",id)
	const now = (new Date()).getTime()
	if (!r.rh.SENSORPACKETS[id].lastSent || now-r.rh.SENSORPACKETS[id].lastSent>=500) {
		r.sockets.writeToList('sensorListeners', {sensor: {id: id, values: v}, type: "sensorInformation"})
		r.rh.SENSORPACKETS[id].lastSent = now
	}
}
for (var sn in r.rh.SENSORIDS) {
	var id = r.rh.SENSORIDS[sn]
	//console.log("adding sensor callback for ",id)
	r.rh.sensorCallbacks.addCallback(id, sensorToServerFn)
}






