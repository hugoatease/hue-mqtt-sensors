const hue = require("node-hue-api").v3;
const mqtt = require("mqtt");
const yargs = require("yargs");
const MQTTPattern = require("mqtt-pattern");
const { parse } = require("yargs");
const { isNumber } = require("lodash");

const FUNCTION_PATTERN = "hue-sensors/+function/#";
const TOPIC_PATTERN_SET = "hue-sensors/set/+type/+id";

const argv = yargs.options({
  "client-id": {
    describe: "Hue Remote API Client ID",
    demandOption: true,
  },
  "client-secret": {
    describe: "Hue Remote API Client Secret",
    demandOption: true,
  },
  "mqtt-url": {
    describe: "MQTT connection URL",
    demandOption: true,
  },
  "access-token": {
    demandOption: true,
  },
  "refresh-token": {
    demandOption: true,
  },
  "bridge-username": {
    demandOption: true,
  },
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

(async () => {
  const api = await remote.connectWithTokens(
    argv.accessToken,
    argv.refreshToken,
    argv.bridgeUsername
  );

  await publishAllSensors(api);
  client.on("message", handleMessage(api));

  setInterval(() => publishAllSensors(api), argv.interval * 1000);
  client.subscribe("hue-sensors/set/#");
})();
