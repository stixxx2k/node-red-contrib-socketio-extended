module.exports = function(RED) {
  const { Server } = require("socket.io");
  var io;
  var customProperties = {};
  var sockets = [];

  function socketIoConfig(settings) {
    RED.nodes.createNode(this, settings);
    var node = this;
    this.port = settings.port || 80;
    this.serveClient = settings.serveClient;
    this.path = settings.path || "/socket.io";
    this.bindToNode = settings.bindToNode || false;
    this.corsOrigins = settings.corsOrigins || "*";
    this.corsMethods = settings.corsMethods?.toUpperCase().split(",") || "GET,POST";
    this.enableCors = settings.enableCors || false;

    node.log("CORS Enabled " + JSON.stringify(this.enableCors));
    node.log("CORS METHODS " + JSON.stringify(this.corsMethods));
    node.log("CORS ORIGINS " + JSON.stringify(this.corsOrigins));

    let corsOptions = {};

    if (this.enableCors) {
      corsOptions = {
        cors: {
          origin: this.corsOrigins,
          methods: this.corsMethods
        }
      };
    }

    if (this.bindToNode) {
      io = new Server(RED.server, corsOptions);
    } else {
      io = new Server(corsOptions);
      io.serveClient(node.serveClient);
      io.path(node.path);
      io.listen(node.port);
    }
    var bindOn = this.bindToNode
      ? "bind to Node-RED port"
      : "on port " + this.port;
    node.log("Created server " + bindOn);

    node.on("close", function() {
      if (!this.bindToNode) {
        io.close();
      }
      sockets.forEach(function (socket) {
        node.log('disconnect:' + socket.id);
        socket.disconnect(true);
      });
      sockets = [];
    });
  }

  function socketIoIn(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.server = RED.nodes.getNode(n.server);
    this.rules = n.rules || [];

    this.specialIOEvent = [
      // Events emitted by the Manager:
      { v: "open" },
      { v: "error" },
      { v: "close" },
      { v: "ping" },
      { v: "packet" },
      { v: "reconnect_attempt" },
      { v: "reconnect" },
      { v: "reconnect_error" },
      { v: "reconnect_failed" },

      // Events emitted by the Socket:
      { v: "connect" },
      { v: "connect_error" },
      { v: "disconnect" }
    ];

    function addListener(socket, val, i) {
      socket.on(val.v, function(msgin) {
        var msg = {};
        RED.util.setMessageProperty(msg, "payload", msgin, true);
        RED.util.setMessageProperty(msg, "socketIOEvent", val.v, true);
        RED.util.setMessageProperty(msg, "socketIOId", socket.id, true);
        if (
          customProperties[RED.util.getMessageProperty(msg, "socketIOId")] !=
          null
        ) {
          RED.util.setMessageProperty(
            msg,
            "socketIOStaticProperties",
            customProperties[RED.util.getMessageProperty(msg, "socketIOId")],
            true
          );
        }
        node.send(msg);
      });
    }

    io.on("connection", function(socket) {
      sockets.push(socket);
      node.rules.forEach(function(val, i) {
        addListener(socket, val, i);
      });
      //Adding support for all other special messages
      node.specialIOEvent.forEach(function(val, i) {
        addListener(socket, val, i);
      });
    });
  }

  function socketIoOut(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.server = RED.nodes.getNode(n.server);

    node.on("input", function(msg) {
      if (RED.util.getMessageProperty(msg, "socketIOAddStaticProperties")) {
        if (customProperties[RED.util.getMessageProperty(msg, "socketIOId")] != null) {
          var keys = Object.getOwnPropertyNames(
            RED.util.getMessageProperty(msg, "socketIOAddStaticProperties")
          );
          var tmp = customProperties[RED.util.getMessageProperty(msg, "socketIOId")];
          for (var i = 0; i < keys.length; i++) {
            tmp[keys[i]] = RED.util.getMessageProperty(msg, "socketIOAddStaticProperties")[keys[i]];
          }
        } else {
          customProperties[RED.util.getMessageProperty(msg, "socketIOId")] = RED.util.getMessageProperty(msg, "socketIOAddStaticProperties");
        }
      }

      switch (RED.util.getMessageProperty(msg, "socketIOEmit")) {
        case "broadcast.emit":
          if (io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId"))) {
            io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId")).broadcast.emit(msg.socketIOEvent, msg.payload);
          }
          break;
        case "emit":
          if (io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId"))) {
            io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId")).emit(msg.socketIOEvent, msg.payload);
          }
          break;
        case "room":
          if (msg.room) {
            io.to(msg.room).emit(msg.socketIOEvent, msg.payload);
          }
          break;
        default:
          io.emit(msg.socketIOEvent, msg.payload);
      }
    });
  }

  function socketIoJoin(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.server = RED.nodes.getNode(n.server);

    node.on("input", function(msg) {
      if (io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId"))) {
        io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId")).join(msg.payload.room);
        node.send(msg);
      }
    });
  }

  function socketIoRooms(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.server = RED.nodes.getNode(n.server);

    node.on("input", function(msg) {
      node.send({ payload: io.sockets.adapter.rooms });
    });
  }

  function socketIoLeave(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.server = RED.nodes.getNode(n.server);

    node.on("input", function(msg) {
      if (io.sockets.sockets.get(RED.util.getMessageProperty(msg, "socketIOId"))) {
        io.sockets.sockets.get(
          RED.util.getMessageProperty(msg, "socketIOId")
        ).leave(msg.payload.room);
      }
    });
  }

  RED.nodes.registerType("socketio-config", socketIoConfig);
  RED.nodes.registerType("socketio-in", socketIoIn);
  RED.nodes.registerType("socketio-out", socketIoOut);
  RED.nodes.registerType("socketio-join", socketIoJoin);
  RED.nodes.registerType("socketio-rooms", socketIoRooms);
  RED.nodes.registerType("socketio-leave", socketIoLeave);
};
