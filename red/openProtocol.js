/*
   Copyright 2018 Smart-Tech Controle e Automação

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
"use strict";
/*jshint esversion: 6, node: true*/

const openProtocol = require('node-open-protocol');
const base = require('../base.json');
const {
    EventEmitter
} = require('events');


module.exports = function (RED) {

    // <Begin> --- Config ---
    function OpenProtocolConfig(values) {

        EventEmitter.call(this);
        RED.nodes.createNode(this, values);

        let node = this;

        node.controllerIP = values.controllerIP;
        node.controllerPort = Number(values.controllerPort);
        node.keepAlive = values.keepAlive;
        node.timeout = values.timeout;
        node.retries = values.retries;
        node.rawData = values.rawData;
        node.genericMode = values.generic;
        node.forceLinkLayer = values.linkLayer;
        node.disablemidparsing = values.disablemidparsing;

        node.userDisconnect = false;
        node.onClose = false;

        let parsingDisable = {};

        node.disablemidparsing.split(/[,; ]+/).map((item) => {
            return Number(item);
        }).forEach((elm) => {
            parsingDisable[elm] = true;
        });

        if (node.forceLinkLayer === 'false') {
            node.forceLinkLayer = false;
        } else {
            if (node.forceLinkLayer === 'true') {
                node.forceLinkLayer = true;
            } else {
                node.forceLinkLayer = undefined;
            }
        }

        let opts = {
            linkLayerActivate: node.forceLinkLayer,
            genericMode: node.genericMode,
            keepAlive: Number(node.keepAlive),
            rawData: node.rawData,
            timeOut: Number(node.timeout),
            retryTimes: Number(node.retries),
            disableMidParsing: parsingDisable
        };

        node.connectionStatus = false;

        node.connect = function connect() {

            if (node.connectionStatus) {
                return;
            }

            node.op = openProtocol.createClient(node.controllerPort, node.controllerIP, opts, (data) => node.onConnect(data));
            node.op.on("error", (err) => node.onErrorOP(err));
        };

        node.connect();

        node.onConnect = function onConnect(data) {

            clearTimeout(node.timerReconnect);

            node.connectionStatus = true;

            node.op.on("__SubscribeData__", (data) => node.onSubscribeDataOP(data));
            node.op.on("close", (error) => node.onCloseOP(error));
            node.op.on("connect", (data) => node.onConnectOP(data));
            node.op.on("data", (data) => node.onDataOP(data));
            node.emit("connect", data);
        };

        node.disconnect = function disconnect() {

            node.removeListenersOP();

            node.op.close();

            node.connectionStatus = false;
            node.emit("disconnect");

            node.userDisconnect = true;
        };

        node.reconnect = function reconnect() {

            clearTimeout(node.timerReconnect);

            if (node.onClose || node.userDisconnect || node.connectionStatus) {
                return;
            }

            node.connect();
        };


        // Begin::Event of Session Control Client - Open Protocol
        node.onErrorOP = function onErrorOP(error) {

            if (node.onClose) {
                return;
            }

            if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {

                node.connectionStatus = false;

                node.emit("disconnect");

                node.error(`${RED._("open-protocol.message.failed-connect")} ${error.address}:${error.port}`);

                node.removeListenersOP();

                clearTimeout(node.timerReconnect);
                node.timerReconnect = setTimeout(() => node.reconnect(), 5000);

                return;
            }

            node.error(error);
        };

        node.onCloseOP = function onCloseOP(error) {

            if (node.onClose) {
                return;
            }

            node.connectionStatus = false;
            node.emit("disconnect");

            node.removeListenersOP();

            clearTimeout(node.timerReconnect);
            node.timerReconnect = setTimeout(() => node.reconnect(), 5000);

        };

        node.onConnectOP = function onConnectOP(data) {
            node.emit("connect", data);
        };

        node.onDataOP = function onDataOP(data) {
            node.emit("data", data);
        };

        node.onSubscribeDataOP = function onSubscribeDataOP(data) {
            node.emit(data.key, data.data);
        };

        node.removeListenersOP = function removeListenersOP() {
            node.op.removeListener("error", (err) => node.onErrorOP(err));
            node.op.removeListener("__SubscribeData__", (data) => node.onSubscribeDataOP(data));
            node.op.removeListener("close", (error) => node.onCloseOP(error));
            node.op.removeListener("connect", (data) => node.onConnectOP(data));
            node.op.removeListener("data", (data) => node.onDataOP(data));
        };
        // End::Event of Session Control Client - Open Protocol


        node.on("close", () => {

            node.onClose = true;
            clearTimeout(node.timerReconnect);

            node.removeListenersOP();

            node.connectionStatus = false;
            node.emit("disconnect");
            node.op.close();

        });

    }

    RED.nodes.registerType("op config", OpenProtocolConfig);
    // <End> --- Config

    // <Begin> --- Node
    function OpenProtocolNode(values) {

        RED.nodes.createNode(this, values);

        let node = this;

        node.config = RED.nodes.getNode(values.config);

        node.midGroup = values.midGroup;
        node.customMid = values.customMid;
        node.revision = values.revision;
        node.customRevision = values.customRevision;
        node.autoSubscribe = values.autoSubscribe;
        node.forwardErrors = values.forwardErrors;

        node.config.on("connect", (data) => node.onConnect(data));
        node.config.on("disconnect", () => node.onDisconnect());

        node.onConnect = function onConnect(data) {

            node.status({
                fill: "green",
                shape: "ring",
                text: RED._("open-protocol.util.label.connected")
            });

            if (node.midGroup === "Connect") {
                let message = {};
                message.payload = data.payload;
                setMessage(message, data);
                node.send(message);
            }

            if (base[node.midGroup]) {
                if (node.autoSubscribe && base[node.midGroup].typeRequest === "SUBSCRIBE") {
                    onInput(node, {});
                }
            }
        };

        node.onDisconnect = function onDisconnect() {
            node.status({
                fill: "red",
                shape: "ring",
                text: RED._("open-protocol.util.label.disconnected")
            });

            if (base[node.midGroup]) {
                let reference = base[node.midGroup];
                node.config.removeListener(reference.family, node.onSubscribe);
            }
        };

        node.onData = function onData(data) {
            let message = {};
            message.payload = data.payload;
            setMessage(message, data);
            node.send([null, message]);
        };

        node.onSubscribe = function onSubscribe(data) {
            let message = {};
            message.payload = data.payload;
            setMessage(message, data);

            //Alarm MID  ->> [Feedback, Data, Status, ACK]
            if (node.midGroup === 71) {

                if (data.mid === 71) {
                    //Data
                    node.send([null, message, null, null]);
                    return;
                }

                if (data.mid === 76) {
                    //Status
                    node.send([null, null, message, null]);
                    return;
                }

                if (data.mid === 74) {
                    //ACK
                    node.send([null, null, null, message]);
                    return;
                }

            } else {
                node.send([null, message]);
            }
        };

        if (node.midGroup === "Custom") {
            node.config.on("data", (data) => node.onData(data));
        }


        node.on("input", (msg) => {

            if (node.midGroup === "Custom") {

                let opts = {
                    revision: msg.revision,
                    payload: msg.payload
                };

                node.config.op.sendMid(msg.mid, opts)
                    .then(data => {

                        if (data) {
                            msg.payload = data.payload;
                            setMessage(msg, data);
                        }

                        node.send([msg, null]);
                    })
                    .catch(err => {

                        msg.error = err.stack || err;

                        if (node.forwardErrors) {
                            node.send([msg, null]);
                        }

                        node.error(RED._("open-protocol.message.error-send-mid"), msg);
                    });

                return;
            }

            if (node.midGroup === "Connect") {

                if (msg.connect != undefined) {
                    if (msg.connect) {
                        node.config.connect();
                    } else {
                        node.config.disconnect();
                    }
                }

                return;
            }

            onInput(node, msg);

        });

        node.on("close", () => {

            node.config.removeListener("connect", (data) => node.onConnect(data));
            node.config.removeListener("disconnect", () => node.onDisconnect());

            if (base[node.midGroup]) {
                let reference = base[node.midGroup];
                node.config.removeListener(reference.family, node.onSubscribe);
            }

            //Alarm MID
            if (node.midGroup === 71) {
                node.config.removeListener("alarmAcknowledged", node.onSubscribe);
                node.config.removeListener("alarmStatus", node.onSubscribe);
            }

        });

        function onInput(node, msg) {

            let reference = base[node.midGroup];
            let opts = {};
            opts.revision = node.revision || msg.revision;
            opts.revision = node.adjustRevision(opts.revision);

            if (msg.payload) {
                opts.payload = msg.payload || "";
            }

            switch (reference.typeRequest) {

                case "REQUEST":
                    node.config.op.request(reference.family, opts)
                        .then(data => {
                            msg.payload = data.payload;
                            setMessage(msg, data);
                            node.send(msg);
                        })
                        .catch(err => {
                            msg.error = err;
                            if (node.forwardErrors) {
                                node.send(msg);
                            }
                            node.error(RED._("open-protocol.message.error-request") + err, msg);
                        });

                    break;

                case "SUBSCRIBE":

                    if (msg.subscribe !== undefined && !msg.subscribe) {

                        node.config.op.unsubscribe(reference.family)
                            .then(data => {
                                msg.payload = data.payload;
                                setMessage(msg, data);
                                node.send([msg, null]);
                                node.config.removeListener(reference.family, node.onSubscribe);

                                //Alarm MID
                                if (node.midGroup === 71) {
                                    node.config.removeListener("alarmAcknowledged", node.onSubscribe);
                                    node.config.removeListener("alarmStatus", node.onSubscribe);
                                }
                            })
                            .catch(err => {
                                msg.error = err;
                                if (node.forwardErrors) {
                                    node.send([msg, null]);
                                }
                                node.error(RED._("open-protocol.message.error-unsubscribe"), msg);
                            });

                        return;
                    }

                    node.config.op.subscribe(reference.family, opts)
                        .then(data => {
                            msg.payload = data.payload;
                            setMessage(msg, data);
                            node.send([msg, null]);

                            node.config.on(reference.family, node.onSubscribe);

                            //Alarm MID
                            if (node.midGroup === 71) {
                                node.config.on("alarmAcknowledged", node.onSubscribe);
                                node.config.on("alarmStatus", node.onSubscribe);
                            }
                        })
                        .catch(err => {
                            msg.error = err;
                            if (node.forwardErrors) {
                                node.send([msg, null]);
                            }

                            node.error(RED._("open-protocol.message.error-subscribe"), msg);
                        });

                    break;

                case "COMMAND":
                    node.config.op.command(reference.family, opts)
                        .then(data => {
                            msg.payload = data.payload;
                            setMessage(msg, data);
                            node.send(msg);
                        })
                        .catch(err => {
                            msg.error = err;
                            if (node.forwardErrors) {
                                node.send(msg);
                            }
                            node.error(RED._("open-protocol.message.error-command"), msg);
                        });

                    break;
            }
        }

        node.adjustRevision = function adjustRevision(revision) {

            if (revision === "Custom") {
                return node.customRevision;
            }

            if (revision === "Auto") {
                return undefined;
            }

            return Number(revision);
        };

        function setMessage(msg, data) {

            msg.mid = data.mid;
            msg.revision = data.revision;
            msg.noAck = data.noAck;
            msg.stationID = data.stationID;
            msg.spindleID = data.spindleID;
            msg.sequenceNumber = data.sequenceNumber;
            msg.messageParts = data.messageParts;
            msg.messageNumber = data.messageNumber;

            if (node.config.rawData) {
                msg._rawData = data._raw;
            }
        }
    }

    RED.nodes.registerType("op node", OpenProtocolNode);
    // <End> --- Node

};