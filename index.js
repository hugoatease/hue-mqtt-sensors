const hue = require("node-hue-api").v3;
const mqtt = require("mqtt");
const yargs = require("yargs");

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

const publishSensorData = async (api) => {
  const sensors = await api.sensors.getAll();

  for (const sensor of sensors) {
    client.publish(
      `${argv.mqttPrefix}/status/${sensor.type}/${sensor.id}`,
      JSON.stringify({
        val: getSensorValue(sensor),
        ts: sensor.lastUpdated,
        payload: sensor.getHuePayload(),
      })
    );
  }
};

(async () => {
  const api = await remote.connectWithTokens(
    argv.accessToken,
    argv.refreshToken,
    argv.bridgeUsername
  );

  await publishSensorData(api);

  setInterval(() => publishSensorData(api), argv.interval * 1000);
})();
