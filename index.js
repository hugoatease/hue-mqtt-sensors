#!/usr/bin/env node

const hue = require("node-hue-api").v3;
const mqtt = require("mqtt");
const yargs = require("yargs");
const MQTTPattern = require("mqtt-pattern");
const { parse } = require("yargs");
const { get, isNumber } = require("lodash");
const persist = require("persist-json")("hue-mqtt-sensors");

const FUNCTION_PATTERN = "hue-sensors/+function/#";
const TOPIC_PATTERN_SET = "hue-sensors/set/+type/+id";

const argv = yargs.options({
  "client-id": {
    describe: "Hue Remote API Client ID",
  },
  "client-secret": {
    describe: "Hue Remote API Client Secret",
  },
  "mqtt-url": {
    describe: "MQTT connection URL",
    demandOption: true,
  },
  "access-token": {},
  "refresh-token": {},
  "bridge-username": {},
  "mqtt-prefix": {
    default: "hue-sensors",
  },
  interval: {
    describe: "Bridge polling interval (in seconds)",
    default: 60,
  },
}).argv;

const remote = hue.api.createRemote(argv.clientId, argv.clientSecret);
const client = mqtt.connect(argv.mqttUrl);

const getSensorValue = (sensor) => {
  switch (sensor.type) {
    case "ZLLTemperature":
      return sensor.temperature;
    case "Daylight":
      return sensor.daylight;
    case "ZLLPresence":
      return sensor.presence;
    case "ZLLLightLevel":
      return sensor.lightlevel;
    case "CLIPGenericStatus":
      return sensor.status;
  }
};

const setSensorValue = (sensor, message) => {
  const value = message.toString();
  switch (sensor.type) {
    case "CLIPGenericStatus":
      if (!isNumber) {
        return sensor;
      }
      sensor.status = value;
      return sensor;
    default:
      return sensor;
  }
};

const publishSensor = (sensor) =>
  client.publish(
    `${argv.mqttPrefix}/status/${sensor.type}/${sensor.id}`,
    JSON.stringify({
      val: getSensorValue(sensor),
      ts: sensor.lastUpdated,
      payload: sensor.getHuePayload(),
    })
  );

const publishAllSensors = async (api) => {
  const sensors = await api.sensors.getAll();

  for (const sensor of sensors) {
    publishSensor(sensor);
  }
};

const handleSetMessage = async (api, topic, message) => {
  const params = MQTTPattern.exec(TOPIC_PATTERN_SET, topic);
  if (!params) {
    return;
  }

  const { type, id } = params;
  const sensor = await api.sensors.getSensor(id);
  setSensorValue(sensor, message);
  await api.sensors.updateSensorState(sensor);
  const result = await api.sensors.getSensor(id);
  publishSensor(result);
};

const handleMessage = (api) => (topic, ...params) => {
  const parsedTopic = MQTTPattern.exec(FUNCTION_PATTERN, topic);
  if (!parsedTopic) {
    return;
  }

  switch (parsedTopic.function) {
    case "set":
      return handleSetMessage(api, topic, ...params);
    default:
      return null;
  }
};

const getLocalApi = async () => {
  const searchResults = await hue.discovery.nupnpSearch();
  const device = searchResults[0];
  const bridgeAddress = device.ipaddress;
  const config = persist.load("config.json");

  const bridgeConfig = get(config, ["bridges", bridgeAddress]);

  if (bridgeConfig) {
    return hue.api.createLocal(bridgeAddress).connect(bridgeConfig.username);
  } else {
    const unauthenticatedApi = await hue.api
      .createLocal(bridgeAddress)
      .connect();
    const user = await unauthenticatedApi.users.createUser(
      "hue-mqtt-sensors",
      device.name
    );
    persist.save("config.json", {
      bridges: {
        [bridgeAddress]: {
          username: user.username,
        },
      },
    });
    return hue.api.createLocal(bridgeAddress).connect(user.username);
  }
};

(async () => {
  let api;
  if (argv.accessToken && argv.refreshToken) {
    api = await remote.connectWithTokens(
      argv.accessToken,
      argv.refreshToken,
      argv.bridgeUsername
    );
  } else {
    api = await getLocalApi();
  }

  await publishAllSensors(api);
  client.on("message", handleMessage(api));

  setInterval(() => publishAllSensors(api), argv.interval * 1000);
  client.subscribe("hue-sensors/set/#");
})();
