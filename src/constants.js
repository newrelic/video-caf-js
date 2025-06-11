
export const DEFAULT_HARVEST_TIME = 30000 // 30 seconds
export const DEFAULT_BUFFER_SIZE = 100 // 100 events

export const NR_ENDPOINT = {
    US: 'US', // Endpoint for US-based accounts.
    EU: 'EU', // Endpoint for EU-based accounts.
    STAGING: 'staging', // Staging endpoint.
};

export const DATA_TOKENS_PAYLOAD = [
    [
      "newrelic_mobile_example", 
      "1.1", 
      "com.newrelic.newrelic_mobile_example" 
    ],
    [
        "Android",
        "14", 
        "sdk_gphone64_arm64", 
        "AndroidAgent",
        "7.4.0-alpha01", 
        "b797aee6-aa69-4879-9ba3-1f4aed1a7777", 
        "", 
        "", 
        "Google",
        {
            "size": "normal",
            "platform": "Flutter", 
            "platformVersion": "1.0.8"
        }
    ]
];

export const DEVICE_INFO = [
    "Chromecast", 
    "15", 
    "sdk_gphone64_arm64", 
    "CAF",
    "7.6.3", 
    "b797aee6-aa69-4879-9ba3-1f4aed1a7777",
    "", 
    "", 
    "Google", 
    {
        "size": "normal",
        "platform": "Native", 
        "platformVersion": "7.6.3"
    }
];

export const CHROMECAST_METADATA = {
    "osBuild": "12228598",
    "newRelicVersion": "7.6.3",
    "osMajorVersion": "15",
    "sessionId": "a232b47f-2cca-4a4f-818c-2ea88b68e764",
    "osName": "Chromecast",
    "sessionDuration": 185.33299255371094,
    "uuid": "7133d358-7cf2-46f5-9747-fbe1da25ba13",
    "platform": "Native",
    "appBuild": "2",
    "carrier": "T-Mobile",
    "osVersion": "15",
    "lastInteraction": "Display VideoPlayer",
    "platformVersion": "7.6.3",
    "deviceModel": "sdk_gphone64_arm64",
    "memUsageMb": 92.0,
    "runTime": "2.1.0",
    "deviceManufacturer": "Google",
    "architecture": "aarch64",
};
