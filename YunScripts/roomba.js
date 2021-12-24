

const SerialPort = require("serialport")
const net = require('net')
const JsonSocket = require('json-socket')
const readline = require("readline")
const EventEmitter = require("events").EventEmitter

function createUUID() {
   return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
   });
}

function Roomba(opts) { // higher level functions

	// default options
	opts = opts || {}
	this.linux_arduino_baud = opts.linux_arduino_baud || 38400
	this.roomba_baud = opts.roomba_baud || 38400
	this.tcp_port = opts.tcp_port || 8080

	// Hardwareconnection
	this.onConnected = undefined
	this.rh = new RoombaHardware()
	this.wakeupIntervalVal = undefined
	this.rh.onConnected = (function() {

		// start sensor stream
		if (!this.checkStreamedPacketsSize(this.streamedPackets)) {
			console.log("not able to stream all packets with selected baud")
			this.stripStreamedPacketsToSize(this.getMaxBpsPossible())
		}
		console.log("asking to stream following packets")
		console.log(this.streamedPackets)
		console.log("bytesize:",this.getStreamedPacketsSize())
		console.log("max bps:",this.getMaxBpsPossible())
		this.rh.stream(this.streamedPackets)

		// wakeup handling
		this.wakeupIntervalVal = setInterval((function() {
			this.rh.wake_up()
		}).bind(this), 60000)

		if (this.onConnected) {
			this.onConnected()
		}
	}).bind(this)


	// setup streamed values
	this.streamedPackets = [
		this.rh.SENSORIDS.Bumps_and_Wheel_Drops,
		this.rh.SENSORIDS.Cliff_Left,
		this.rh.SENSORIDS.Cliff_Front_Left,
		this.rh.SENSORIDS.Cliff_Front_Right,
		this.rh.SENSORIDS.Cliff_Right,
		//this.rh.SENSORIDS.Cliff_Left_Signal,
		//this.rh.SENSORIDS.Cliff_Front_Left_Signal,
		//this.rh.SENSORIDS.Cliff_Front_Right_Signal,
		//this.rh.SENSORIDS.Cliff_Right_Signal,
		this.rh.SENSORIDS.Light_Bump_Left_Signal,
		this.rh.SENSORIDS.Light_Bump_Front_Left_Signal,
		this.rh.SENSORIDS.Light_Bump_Center_Left_Signal,
		this.rh.SENSORIDS.Light_Bump_Center_Right_Signal,
		this.rh.SENSORIDS.Light_Bump_Front_Right_Signal,
		this.rh.SENSORIDS.Light_Bump_Right_Signal,
		//this.rh.SENSORIDS.Infrared_Character_Omni,
		//this.rh.SENSORIDS.Infrared_Character_Left,
		//this.rh.SENSORIDS.Infrared_Character_Right,
		//this.rh.SENSORIDS.Distance,
		//this.rh.SENSORIDS.Angle,
		//this.rh.SENSORIDS.Battery_Charge,
		//this.rh.SENSORIDS.Battery_Capacity,
	]
	this.getMaxBpsPossible = function() {
		var min_baud = Math.min(this.roomba_baud, this.linux_arduino_baud)
		var Bps_possible = min_baud/10
		return Bps_possible
	}
	this.makeStreamedPacketsUnique = function() {
		this.streamedPackets = this.streamedPackets.filter(function(value, index, self) {
			return self.indexOf(value) === index;
		})
	}
	this.getStreamedPacketsSize = function() {
		var bytesize = 0
		for (var i=0; i<this.streamedPackets.length; i++) {
			bytesize += this.rh.SENSORPACKETS[this.streamedPackets[i]].size
		}
		return bytesize
	}
	this.checkStreamedPacketsSize = function() {
		this.makeStreamedPacketsUnique()

		var bytesize = this.getStreamedPacketsSize()

		var bps_possible = this.getMaxBpsPossible()
		if (bytesize > bps_possible*0.015) {
			return false
		}
		return bytesize
	}
	this.stripStreamedPacketsToSize = function(size) {
		var bytesize = 0
		var i=0
		for (i=0; i<pkts.length; i++) {
			bytesize += this.rh.SENSORPACKETS[this.streamedPackets[i]].size
			if (bytesize >= size) {
				break
			}
		}
		this.streamedPackets.splice(0,i)
	}

	this.sensorChangeEventFn = function(sid, val) {
		var sp = this.rh.SENSORPACKETS[sid]
		if (JSON.stringify(sp.lastval) != JSON.stringify(val)) {
			this.emit(sp.name, val, sid)
			for (var i=0; i<sp.events.length; i++) {
				this.emit(sp.events[i], val, sid)
			}
		}
		this.rh.SENSORPACKETS[sid].lastval = val
	}

	// events
	this.sensorChangeEventSensors = [
		this.rh.SENSORIDS.Bumps_and_Wheel_Drops,
		this.rh.SENSORIDS.Cliff_Left,
		this.rh.SENSORIDS.Cliff_Front_Left,
		this.rh.SENSORIDS.Cliff_Front_Right,
		this.rh.SENSORIDS.Cliff_Right,
		this.rh.SENSORIDS.Infrared_Character_Omni,
	]
	for (var i=0; i<this.sensorChangeEventSensors.length; i++) {
		var sid = this.sensorChangeEventSensors[i]
		this.rh.sensorCallbacks.addCallback(sid, (this.sensorChangeEventFn).bind(this))
	}

	this.plan = new Plan([
		new TimedAction((function() {this.rh.full()}).bind(this),10),
		new TimedAction((function() {this.rh.beep3()}).bind(this),20),
		//new TimedAction((function() {this.rh.safe()}).bind(this),400),
		new TimedAction((function() {console.log("end of plan")}).bind(this),8000),
	])

	this.rh.connect(this.linux_arduino_baud, this.roomba_baud)

	// Networking
	this.sockets = new Sockets()
	this.server = new net.Server()
	this.server.listen(this.tcp_port, (function() {
		console.log("Server listening for connection requests on socket localhost:"+this.tcp_port+".")
	}).bind(this))
	this.server.on('connection', (function(socket) {
		socket = new JsonSocket(socket)
		console.log('A new connection has been established with '+this.sockets.socketName(socket));

		socket.sendMessage('Hello, client.\n');

		socket.on('message', (function(chunk) {
			//var s = chunk.toString()
			var s = chunk
			console.log("Data received from client: "+s);
			if (!this.handleSocketData(socket,s)) {
				this.handleTerminalInput(s)
			}
		}).bind(this))

		socket.on('end', function() {
			// client wants to close
		})

		socket.on('close', (function() {
			console.log('Closing connection with the client');
			this.sockets.removeSocket(socket)
			console.log(this.sockets.lists)
		}).bind(this))

		socket.on('error', function(err) {
			console.log("Error: "+err)
		})
	}).bind(this))

	this.handleSocketData = function(socket,s) {
		if (s.indexOf("socketlists")==0) {
			var lists = s.substring(11).split(",")
			console.log("adding to lists",lists)
			this.sockets.addSocket(socket, lists)
			console.log(this.sockets.lists)
			return true
		} else if (s.indexOf("rsocketlists")==0) {
			var lists = s.substring(12).split(",")
			console.log("removing from lists",lists)
			for (var i=0; i<lists.length; i++) {
				this.sockets.removeSocketFromList(socket, lists[i])
			}
			console.log(this.sockets.lists)
			return true
		}
		return false
	}


	// console input
	this.rl = readline.createInterface({
	  input: process.stdin,
	  output: this.rh.port, // don't write to rl!!
	})

	this.rl.on('line', (function(line) {
		this.handleTerminalInput(line)
	}).bind(this))

	this.handleTerminalInput = function(line) {
		if (line.indexOf("safe")==0) {
			this.rh.safe()
		} else if (line.indexOf("full")==0) {
			this.rh.full()
		} else if (line.indexOf("power")==0) {
			this.rh.power()
		} else if (line.indexOf("start")==0) {
			this.rh.start()
		} else if (line.indexOf("wake_up")==0) {
			this.rh.wake_up()
		} else if (line.indexOf("drive")==0) {
			this.rh.full()
			this.rh.drive(100,0)
		} else if (line.indexOf("stopstream")==0) {
			this.rh.pauseresumeStream(0)
		} else if (line.indexOf("resumestream")==0) {
			this.rh.pauseresumeStream(1)
		} else if (line.indexOf("stop")==0) {
			this.rh.stop()
		} else if (line.indexOf("reset")==0) {
			this.rh.reset()
		} else if (line.indexOf("halt")==0) {
			this.rh.drive(0,0)
			this.rh.safe()
		} else if (line.indexOf("baud")==0) {
			var baud = parseInt(line.substring(4))
			this.rh.start()
			this.rh.baud(baud)
			this.rh.arduinobaudChange(baud)
		} else {
			var firstw = line.replace(/ .*/,"")
			if (firstw in this.rh.OPCODE) {
				this.rh.sendByte(this.rh.OPCODE[firstw]) // TODO: add args
			} else {
				console.log("got",line)
				return line
			}
		}
	}
}

Roomba.prototype = new EventEmitter

function TimedAction(cb, t, opts) {
	opts = opts || {}
	this.uuid = createUUID()
	this.triggerOffset = t
	this.activationTime = 0
	this.timeoutVal = undefined
	this.removeAfterTrigger = opts.removeAfterTrigger || true
	this.planCbs = {}

	this.trigger = function() {
		this.activationTime = (new Date()).getTime()
		cb()
		//console.log("triggering",this.uuid,this.planCbs)
		for (var k in this.planCbs) {
			this.planCbs[k]()
		}
	}
}

function Plan(timedActions, opts) {
	opts = opts || {}
	this.uuid = createUUID()
	this.startTime = undefined
	this.started = false
	this.removeAfterComplete = opts.removeAfterComplete || true
	this.cbCountdown = 0
	this.planCbs = {}
	this.onComplete = {}

	this.actions = {}
	this.incorporatedPlans = {}

	this.completeCountDownFn = (function() {
		this.cbCountdown -= 1
		//console.log("completeCountDownFn", this.cbCountdown)
		if (this.cbCountdown<=0) {
			//console.log("cbCountdown 0", Object.keys(this.onComplete).length)
			this.completeFn()
			
		}
	}).bind(this)

	this.completeFn = (function() {
		for (var k in this.onComplete) {
			this.onComplete[k]()
		}
		for (var k in this.planCbs) {
			this.planCbs[k]()
		}
	}).bind(this)

	this.addTimedActions = function(as) {
		for (var i=0; i<as.length; i++) {
			this.addTimedAction(as[i])
		}
	}
	this.addTimedAction = function(a) {
		this.actions[a.uuid] = a
		a.planCbs[this.uuid] = this.completeCountDownFn
	}
	this.addTimedActions(timedActions)

	this.removeTimedAction = function(a) {
		delete a.planCbs[this.uuid]
		delete this.actions[a.uuid]
	}

	this.removeTimedActions = function(as) {
		for (var i=0; i<as.length; i++) {
			this.removetimedAction(as[i])
		}
	}

	this.incorporatePlan = function(p) {
		this.incorporatedPlans[p.uuid] = p
		this.cbCountdown += 1
		p.planCbs[this.uuid] = this.completeCountDownFn
		if (p.removeAfterComplete) {
			p.planCbs[this.uuid+"_remover"] = (function() {
				delete this.incorporatedPlans[p.uuid]
			}).bind(this)
		}
		// TODO: remove plans after complete
		if (this.started) {
			p.start()
		}
	}

	this.removePlan = function(p) {
		//p.abort()
		delete this.incorporatedPlans[p.uuid]
		this.completeCountDownFn()
		delete p.planCbs[this.uuid]
		if (p.removeAfterComplete) {
			delete p.planCbs[this.uuid+"_remover"]
		}
	}

	this.start = function() {
		this.startTime = (new Date()).getTime()
		this.started = true
		//console.log("start",this.uuid, Object.keys(this.actions).length, Object.keys(this.incorporatedPlans).length)
		this.cbCountdown = Object.keys(this.actions).length + Object.keys(this.incorporatedPlans).length
		//console.log("activating",Object.keys(this.actions).length,"actions",Object.keys(this.actions))
		for (var k in this.actions) {
			//console.log("activate",k)
			this.activateAction(this.actions[k])
		}
		for (var k in this.incorporatedPlans) {
			//console.log("starting plan",this.incorporatedPlans[k])
			this.incorporatedPlans[k].start()
			//this.incorporatedPlans[k].onCompleted[] = this.completeCountDownFn
		}
		if (this.onStart) {
			((this.onStart).bind(this))()
		}
	}

	this.activateAction = function(a) {
		var timePassed = (new Date()).getTime()-this.startTime
		var tVal = a.triggerOffset-timePassed
		if (tVal>=0) {
			//console.log("normal execution",tVal,a.triggerOffset,a.uuid)
			a.timeoutVal = setTimeout((function() {
				a.trigger()
				if (a.removeAfterTrigger) {
					this.removeTimedAction(a)
				}
			}).bind(this), tVal)
		} else if (tVal>-1000 && a.triggerOffset<=1000) {
			//console.log("delayed execution",tVal, a.triggerOffset,a.uuid)
			a.trigger()
			if (a.removeAfterTrigger) {
				this.removeTimedAction(a)
			}
		} else { // TODO: handle not executed
			//console.log("not executing",tVal, a.triggerOffset,a.uuid)
			if (a.removeAfterTrigger) {
				this.removeTimedAction(a)
			}
		}
	}

	this.deactivateAction = function(a) {
		clearTimeout(a.timeoutVal)
	}

	this.abort = function() {
		this.started = false
		for (var i=0; i<this.incorporatedPlans.length; i++) {
			this.incorporatedPlans[i].abort()
		}
		for (var k in this.actions) {
			this.deactivateAction(this.actions[k])
		}
		if (this.onAbort) {
			((this.onAbort).bind(this))()
		}
	}
}


function SensorCallbackHandler() {
	this.sensorCallbacks = []

	this.addCallback = function(id, cb) {
		if (!(id in this.sensorCallbacks)) {
			this.sensorCallbacks[id] = []
		}
		this.sensorCallbacks[id].push(cb)
	}

	this.callCallbacks = function(id, arg) {
		if (id in this.sensorCallbacks) {
			for (var i=0; i<this.sensorCallbacks[id].length; i++) {
				this.sensorCallbacks[id][i](id,arg)
			}
		}
	}

	this.removeCallback = function(id, cb) {
		if (id in this.sensorCallbacks) {
			this.sensorCallbacks[id] = this.sensorCallbacks[id].filter(function(el) { return el!=cb })
		}
	}
}

function Sockets() {
	this.lists = {
		//allSockets: {},
		//sensorListeners: {}
	}

	this.socketName = function(socket) {
		socket = socket._socket
		const sa = socket.remoteAddress
		const sp = socket.remotePort
		if (sa!=undefined && sp!=undefined) {
			return sn = sa+":"+sp
		}
		const spa = socket._peername.address
		const spp = socket._peername.port
		if (spa!=undefined && spp!=undefined) {
			return spa+":"+spp
		}
		return "0:0"
	}

	this.addSocket = function(socket, lists) {
		this.addSocketToList(socket, 'allSockets')
		if (Array.isArray(lists)) {
			for (var i=0; i<lists.length; i++) {
				this.addSocketToList(socket,lists[i])
			}
		} else if (typeof(lists)=='object') {
			this.addSocketToList(socket, lists)
		} else {
			console.log("not adding",lists)
		}
	}

	this.addSocketToList = function(socket, list) {
		this.checkListExists(list)
		const sn = this.socketName(socket)
		if (!(sn in this.lists[list])) {
			this.lists[list][sn]=socket
		}
	}

	this.checkListExists = function(list) {
		if(list==undefined) {
			console.log("list undefined")
		}
		if (!(list in this.lists)) {
			this.lists[list] = {}
		}
	}

	this.removeSocket = function(socket) {
		for (var k in this.lists) {
			this.removeSocketFromList(socket, k)
		}
	}

	this.removeSocketFromList = function(socket, list) {
		this.checkListExists(list)
		const sn = this.socketName(socket)
		delete this.lists[list][sn]
	}

	this.writeToList = function(list,v) {
		this.checkListExists(list)
		for (var sn in this.lists[list]) {
			this.lists[list][sn].sendMessage(v)
		}
	}
}




function printBuffer(b) {
	var str = ""
	for (var i=0; i<b.length; i++) {
		var hs = b[i].toString(16)
		if (hs.length<2) {
			hs = "0"+hs
		}
		str += hs + " "
	}
	console.log(str)
}

function RoombaHardware() { // interfacing with hardware robot
	this.connected = false
	this.buffer = []
	this.state = "not_connected"

	this.starting = true

	this.arduinobaudChange = function(v) {
		console.log("setting arduino to baud:_"+String(v)+"_")
		this.portwrite(":_:baud"+(v).toString()+":_:")
	}
	this.connect = function(baud, roombabaud) {
		this.port = new SerialPort.SerialPort("/dev/ttyATH0", {
			baudRate: baud,
			//parser: SerialPort.parsers.readline('\n')
		});
		this.port.on('open', (function(roombabaud) {
			console.log("port open")

			this.portwrite([128, 128, 128, 128, 128, 128, 128])
			
			//console.log("resetting baud to",115200,":_:baud"+(115200).toString()+":_:")
			//this.portwrite(":_:baud"+(115200).toString()+":_:")
			this.arduinobaudChange(115200)
			console.log("sent")

			console.log("setting timeouts")
			setTimeout((function (baud) {
				console.log("start and baud",baud)
				this.start()
				this.baud(baud)
			}).bind(this, roombabaud), 500)
			setTimeout((function () {
				//console.log("resetting baud to",19200,":_:baud"+(19200).toString()+":_:")
				//this.port.write(":_:baud"+(19200).toString()+":_:")
				this.arduinobaudChange(19200)
			}).bind(this),1000)
			setTimeout((function (baud) {
				console.log("start and baud",baud)
				this.start()
				this.baud(baud)
			}).bind(this, roombabaud),1500)
			setTimeout((function (baud) {
				//console.log("resetting baud to",baud,":_:baud"+baud.toString()+":_:")
				//this.port.write(":_:baud"+baud.toString()+":_:")
				this.arduinobaudChange(baud)
			}).bind(this, roombabaud),2000)
			console.log("set timeouts")

			setTimeout((function () {
				this.state = "openend"
				this.connected = true
				this.start()
				//this.sensors(this.SENSORIDS.OI_Mode)
				console.log("opened")
				if (this.buffer.length>0) {
					console.log("empty buffer")
					while (this.buffer.length>0) {
						var b = this.buffer.shift()
						console.log("writing",b)
						this.portwrite(b)
					}
				}
				if (this.onConnected) {
					this.onConnected()
				}
			}).bind(this), 2500)
		}).bind(this, roombabaud))
		this.port.on('error', (function(err) {
			console.log("Error: "+err.message);
			this.connected = false
		}).bind(this))
		this.port.on('close', (function() {
			console.log("closed ttyATH0");
			this.connected = false
		}).bind(this))
		this.port.on('disconnect', (function(err) {
			console.log("disconnected ttyATH0 "+err);
			this.connected = false
		}).bind(this))
		this.port.on('data', (function(data) {
			this.handleData(data)
		}).bind(this))
		this.portwrite = function(v) { // sends both one byte, a list of bytes and strings and handles errors
			var buf
			if (Array.isArray(v) || typeof(v) == "string") {
				buf = new Buffer(v)
			} else {
				buf = new Buffer([v])
			}
			this.port.write(buf,function(err){
				if (err) {
					console.log("port write error",err)
				}
			})
		}
	}

	this.onConnected = null


	this.OPCODE = {
		"Start": 128,
		"Reset": 7,
		"Stop": 173,
		"Baud": 129,
		"Safe": 131,
		"Full": 132,
		"Clean": 135,
		"Max": 136,
		"Spot": 134,
		"Dock": 143,
		"Power": 133,
		"Schedule": 167,
		"Clock": 168,
		"Drive": 137,
		"DriveDirect": 145,
		"DrivePWM": 146,
		"PWMMotors": 144,
		"LEDs": 139,
		"SchedulingLEDs": 162,
		"DigitalLEDsRaw": 163,
		"Buttons": 165,
		"DigitLEDsASCII": 164,
		"Song": 140,
		"Play": 141,
		"Sensors": 142,
		"QueryList": 149,
		"Stream": 148,
		"PauseResumeStream": 150
	}

	this.parse1unsigned = function(v) {
		return v.readUInt8(0)
	}
	this.parse1signed = function(v) {
		return v.readInt8(0)
	}
	this.parse1splitbits = function(v) {
		var by = v.readUInt8(0)
		var r = []
		for (var i=0; i<8; i++) {
			r.push((by & (1<<i))>0)
		}
		return r
	}
	this.parse2unsigned = function(v) {
		if (v.length<2) {
			console.log("parse2unsigned length error",v)
			return 0
		}
		return v.readUInt16BE(0)
	}
	this.parse2signed = function(v) {
		if (v.length<2) {
			console.log("parse2signed length error",v)
			return 0
		}
		return v.readInt16BE(0)
	}

	this.SENSORIDS = {
		"Bumps_and_Wheel_Drops": 7,
		"Wall": 8,
		"Cliff_Left": 9,
		"Cliff_Front_Left": 10,
		"Cliff_Front_Right": 11,
		"Cliff_Right": 12,
		"Virtual_Wall": 13,
		"Wheel_Overcurrents": 14,
		"Dirt_Detect": 15,
		"Infrared_Character_Omni": 17,
		"Infrared_Character_Left": 52,
		"Infrared_Character_Right": 53,
		"Buttons": 18,
		"Distance": 19,
		"Angle": 20,
		"Charging_State": 21,
		"Voltage": 22,
		"Current": 23,
		"Temperature": 24,
		"Battery_Charge": 25,
		"Battery_Capacity": 26,
		"Wall_Signal": 27,
		"Cliff_Left_Signal": 28,
		"Cliff_Front_Left_Signal": 29,
		"Cliff_Front_Right_Signal": 30,
		"Cliff_Right_Signal": 31,
		"Charging_Sources_Available": 34,
		"OI_Mode": 35,
		"Song_Number": 36,
		"Song_Playing": 37,
		"Number_of_Stream_Packets": 38,
		"Requested_Velocity": 39,
		"Requested_Radius": 40,
		"Requested_Right_Velocity": 41,
		"Requested_Left_Velocity": 42,
		"Left_Encoder_Counts": 43,
		"Right_Encoder_Counts": 44,
		"Light_Bumper": 45,
		"Light_Bump_Left_Signal": 46,
		"Light_Bump_Front_Left_Signal": 47,
		"Light_Bump_Center_Left_Signal": 48,
		"Light_Bump_Center_Right_Signal": 49,
		"Light_Bump_Front_Right_Signal": 50,
		"Light_Bump_Right_Signal": 51,
		"Left_Motor_Current": 54,
		"Right_Motor_Current": 55,
		"Main_Brush_Motor_Current": 56,
		"Side_Brush_Motor_Current": 57,
		"Stasis": 58,
	}
	this.SENSORPACKETS = {
		7: {
			name: "Bumps_and_Wheel_Drops",
			parse: this.parse1splitbits,
			size: 1,
			last_val: 0,
			events: ['wheels', 'bump']
		},
		8: {
			name: "Wall",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		9: {
			name: "Cliff_Left",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: ['cliff']
		},
		10: {
			name: "Cliff_Front_Left",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: ['cliff']
		},
		11: {
			name: "Cliff_Front_Right",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: ['cliff']
		},
		12: {
			name: "Cliff_Right",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: ['cliff']
		},
		13: {
			name: "Virtual_Wall",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		14: {
			name: "Wheel_Overcurrents",
			parse: this.parse1splitbits,
			size: 1,
			last_val: 0,
			events: []
		},
		15: {
			name: "Dirt_Detect",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		16: {
			name: "Unused",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		17: {
			name: "Infrared_Character_Omni",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		52: {
			name: "Infrared_Character_Left",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		53: {
			name: "Infrared_Character_Right",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		18: {
			name: "Buttons",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		19: {
			name: "Distance",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		20: {
			name: "Angle",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		21: {
			name: "Charging_State",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		22: {
			name: "Voltage",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		23: {
			name: "Current",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		24: {
			name: "Temperature",
			parse: this.parse1signed,
			size: 1,
			last_val: 0,
			events: []
		},
		25: {
			name: "Battery_Charge",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		26: {
			name: "Battery_Capacity",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		27: {
			name: "Wall_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		28: {
			name: "Cliff_Left_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		29: {
			name: "Cliff_Front_Left_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		30: {
			name: "Cliff_Front_Right_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		31: {
			name: "Cliff_Right_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		34: {
			name: "Charging_Sources_Available",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		35: {
			name: "OI_Mode",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		36: {
			name: "Song_Number",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		37: {
			name: "Song_Playing",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		38: {
			name: "Number_of_Stream_Packets",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
		39: {
			name: "Requested_Velocity",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		40: {
			name: "Requested_Radius",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		41: {
			name: "Requested_Right_Velocity",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		42: {
			name: "Requested_Left_Velocity",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		43: {
			name: "Left_Encoder_Counts",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		44: {
			name: "Right_Encoder_Counts",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		45: {
			name: "Light_Bumper",
			parse: this.parse1splitbits,
			size: 1,
			last_val: 0,
			events: []
		},
		46: {
			name: "Light_Bump_Left_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		47: {
			name: "Light_Bump_Front_Left_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		48: {
			name: "Light_Bump_Center_Left_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		49: {
			name: "Light_Bump_Center_Right_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		50: {
			name: "Light_Bump_Front_Right_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		51: {
			name: "Light_Bump_Right_Signal",
			parse: this.parse2unsigned,
			size: 2,
			last_val: 0,
			events: []
		},
		54: {
			name: "Left_Motor_Current",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		55: {
			name: "Right_Motor_Current",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		56: {
			name: "Main_Brush_Motor_Current",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		57: {
			name: "Side_Brush_Motor_Current",
			parse: this.parse2signed,
			size: 2,
			last_val: 0,
			events: []
		},
		58: {
			name: "Stasis",
			parse: this.parse1unsigned,
			size: 1,
			last_val: 0,
			events: []
		},
	}

	this.sendByte = function(b, opened) {
		if (this.connected || opened) {
			console.log("writing",b)
			this.portwrite(b)
		} else {
			console.log("buffering")
			console.log(b)
			this.buffer.push(b)
		}
	}

	this.sensorRequests = []

	this.all_buffer = new Buffer(0)
	this.rec_buffer = new Buffer(0)
	this.notarduinocolon = false
	this.wrong_checksums = 0
	this.startup_time = (new Date()).getTime()
	this.handleData = function(d) {
		d = Buffer.concat([this.rec_buffer,d], this.rec_buffer.length+d.length)
		this.all_buffer = Buffer.concat([this.all_buffer,d], this.all_buffer,d.length)
		this.rec_buffer = new Buffer([])


		while (d.length>0) {
			//console.log("while")
			if (d[0]==19) { // stream
				var bc = d[1]
				if (d.length>=3+bc) {
					var checksum = d[2+bc]
					var val = 0
					for (var i=0; i<2+bc; i++) {
						val += d[i]
					}
					val = 0xff&val
					val = (0x100-val)%256
					if (val != checksum) {
						this.wrong_checksums += 1
						console.log("checksum wrong",this.wrong_checksums,this.wrong_checksums/(((new Date()).getTime()-this.startup_time)/1000)+"/s",val.toString(16),checksum.toString(16))
						//printBuffer(d)
						d = d.slice(1)
						continue
					} else {
						//console.log("checksum correct", val.toString(16), checksum.toString(16))
					}
					//console.log("stream val",bc)

					var da = d.slice(0,3+bc)
					d = d.slice(3+bc)
					var ind = 2
					while (ind<2+bc) {
						//console.log("stream while")
						var pkt_id = da[ind]
						var sp = this.SENSORPACKETS[pkt_id]
						if (sp===undefined) {
							console.log("no packet, id",pkt_id,"at index",ind)
							printBuffer(da)
							//printBuffer(this.all_buffer)
							ind += 1
						} else {
							var pda = da.slice(ind+1,ind+1+sp.size)
							var parsed = sp.parse(pda)
							//console.log("packet",pkt_id,parsed)
							this.sensorCallbacks.callCallbacks(pkt_id, parsed)
							ind += sp.size+1
						}
					}
				} else { // collect further
					this.rec_buffer = d
					d = new Buffer(0)
					return
				}

			} else if (d[0]=58 && !this.notarduinocolon) { // possibly arduino
				if (d.length<3) { // we cannot know, collect further
					this.rec_buffer = d
					d = new Buffer(0)
					return
				} else if (d[1]==95 && d[2]==58) { // it is an arduino string beginning
					var str = d.toString().substring(3)
					var eind = str.indexOf(":_:")
					if (eind>=0) {
						str = str.substring(0,eind)
						console.log("arduino says:_"+str+"_")
						d = d.slice(3+eind+3)
					} else if (eind<0 && str.length<60) { // possibly just incomplete
						this.rec_buffer = d
						d = new Buffer(0)
						return
					} else { // no arduino string, continue
						//console.log("no arduino string error")
						d = d.slice(1)
					}
				} else {
					//console.log("not arduino colon")
					this.notarduinocolon = true
				}
			} else {
				this.notarduinocolon = false
				//console.log("no stream")
				//printBuffer(d)
				if (this.sensorRequests.length>0) {
					console.log("sensor request handling")
					// TODO: check correct sensor packet
					var r = this.sensorRequests.shift()
					console.log(r)
					if (d.length>=r.size) {
						var da = d.slice(0,r.size)
						d = d.slice(r.size)
						r.handle(da)
					} else {
						this.rec_buffer = d
						return
					}
				} else {
					//console.log("dont know what to do")
					//printBuffer(d)
					d = d.slice(1)
					//printBuffer(this.all_buffer)
				}
			}
		}
	}

	this.start = function() {
		console.log("writing",this.OPCODE.Start)
		this.portwrite([this.OPCODE.Start])
	}
	this.safe = function() {
		this.sendByte(this.OPCODE.Safe)
	}
	this.full = function() {
		this.sendByte(this.OPCODE.Full)
	}
	this.power = function() {
		this.sendByte(this.OPCODE.Power)
	}
	this.reset = function() {
		this.sendByte(this.OPCODE.Reset)
	}
	this.stop = function() {
		this.sendByte(this.OPCODE.Stop)
	}
	this.baud = function(v) {
		var conv = {
			300: 0,
			600: 1,
			1200: 2,
			2400: 3,
			4800: 4,
			9600: 5,
			14400: 6,
			19200: 7,
			28800: 8,
			38400: 9,
			57600: 10,
			115200: 11
		}
		var code = conv[v]
		console.log("writing",this.OPCODE.Baud,code)
		this.portwrite([this.OPCODE.Baud, code])
	}
	this.clean = function() {
		this.sendByte(this.OPCODE.Clean)
	}
	this.spot = function() {
		this.sendByte(this.OPCODE.Spot)
	}
	this.max = function() {
		this.sendByte(this.OPCODE.Max)
	}
	this.dock = function() {
		this.sendByte(this.OPCODE.Dock)
	}
	this.drive = function(vel_mm_sec, rad_mm) {
		const velb = new ArrayBuffer(2);
		const velv = new DataView(velb);
		velv.setInt16(0, vel_mm_sec);
		var velH = velb[1]
		var velL = velb[0]

		var radH,radL
		if (rad_mm==0) {
			radH = 0x80
			radL = 0x00
		} else {
			const radb = new ArrayBuffer(2);
			const radv = new DataView(radb);
			radv.setInt16(0, rad_mm);
			radH = radb[1]
			radL = radb[0]
		}
		this.sendByte(this.OPCODE.Drive)
		this.sendByte(velH)
		this.sendByte(velL)
		this.sendByte(radH)
		this.sendByte(radL)
	}

	this.sensorCallbacks = new SensorCallbackHandler()

	this.sensors = function(id) {
		this.sendByte(this.OPCODE.Sensors)
		this.sendByte(id)
	}

	this.stream = function(pkts) {
		this.pauseresumeStream(0)
		this.sendByte(this.OPCODE.Stream)
		this.sendByte(pkts.length)
		for (var i=0; i<pkts.length; i++) {
			this.sendByte(pkts[i])
		}
	}

	this.pauseresumeStream = function(resume) {
		this.sendByte(this.OPCODE.PauseResumeStream)
		this.sendByte(resume)
	}

	this.song = function(nr,sd) {
		this.sendByte(this.OPCODE.Song)
		this.sendByte(nr)
		this.sendByte(sd.length/2)
		for (var i=0; i<sd.length; i++) {
			this.sendByte(sd[i])
		}
	}

	this.play = function(nr) {
		this.sendByte(this.OPCODE.Play)
		this.sendByte(nr)
	}

	this.beep3 = function() {
		var s = [68,6,68,6]
		this.song(1,s)
		this.play(1)
	}

	this.wake_up = function() {
		this.portwrite(":_:wakel:_:")
		console.log("sent wakel")
		setTimeout((function() {
			this.portwrite(":_:wakeh:_:")
			console.log("sent wakeh")
		}).bind(this), 1000)
	}

}

exports.Roomba = Roomba
exports.RoombaHardware = RoombaHardware
exports.TimedAction = TimedAction
exports.Plan = Plan


