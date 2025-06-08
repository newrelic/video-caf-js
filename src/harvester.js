import * as nrvideo from "newrelic-video-core";
import {DEFAULT_HARVEST_TIME, DEFAULT_BUFFER_SIZE, NR_ENDPOINT} from './constants'

export default class NRHarvester {
  
    /**
     * Constructor
     * @param {string} licenseKey - The New Relic application license key.
     * @param {string} endpoint - Type of endpoint to use (e.g., 'US', 'EU', 'staging').
     * @param {object} [options] - Optional configuration for harvesting.
     */
    constructor(licenseKey, endpoint, options = {}) {
      this.licenseKey = licenseKey;
      this.endpoint = endpoint;
      this.eventBuffer = [];
      this.harvestInterval = options.harvestInterval || DEFAULT_HARVEST_TIME; 
      this.maxBufferSize = options.maxBufferSize || DEFAULT_BUFFER_SIZE;
      this.harvestTimer = null;
      this.dataToken = null; 
      this.isHarvesting = false;

      this.startHarvestTimer();
    }
  
    startHarvestTimer() {
      if (this.harvestTimer) {
        this.stopHarvestTimer();
      }
      this.harvestTimer = setTimeout(async () => {
        await this.sendBufferedEvents();
      }, this.harvestInterval);
    }

    stopHarvestTimer() {
      if (this.harvestTimer) {
        clearTimeout(this.harvestTimer);
        this.harvestTimer = null;
      }
    }
  
    async addEventToBuffer(eventType, attributes) {
      const event = {
        ...attributes,
        "eventType": eventType,
        "timestamp": new Date().getTime(),
      };
      this.eventBuffer.push(event);
  
      if (this.eventBuffer.length >= this.maxBufferSize) {
        await this.sendBufferedEvents();
      } else {
        if (!this.harvestTimer) {
          this.startHarvestTimer();
        }
      }
    }
  
    async fetchDataTokens() {
      if (this.dataToken) {
        return this.dataToken; 
      }

      const url = this.endpoint == NR_ENDPOINT.STAGING
                ? "https://staging-mobile-collector.newrelic.com/mobile/v5/connect"
                : "https://mobile-collector.newrelic.com/mobile/v5/connect";
      const headers = {
        "X-App-License-Key": this.licenseKey,
        "Content-Type": "application/json",
      };
      const payload = [
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
  
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
        });
  
        if (response.ok) {
          const data = await response.json();
          this.dataToken = data.data_token;
          return data.data_token;
        } else {
          const errorText = await response.text();
          nrvideo.Log.error(`Failed to fetch data token: ${errorText}`);
          return null;
        }
      } catch (error) {
        nrvideo.Log.error(`Error in fetching data token: ${error}`);
        return null;
      }
    }

    async sendToMobileCollector(eventsToProcess) {
      const url = this.endpoint == NR_ENDPOINT.STAGING
              ? "https://staging-mobile-collector.newrelic.com/mobile/v3/data"
              : "https://mobile-collector.newrelic.com/mobile/v3/data";
      const payload = [
          this.dataToken,
          [
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
          ],
          0, 
          [], 
          [], 
          [], 
          [], 
          [], 
          {
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
          },
          eventsToProcess 
      ];
    
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'X-App-License-Key': this.licenseKey
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          return response.json();
        } else {
          throw new Error(`Failed to send events: ${response.statusText}`);
        }
      } catch (error) {
          nrvideo.Log.error('Error sending custom event to mobile collector:', error);
          throw error; 
      }
    }
  
    async sendBufferedEvents() {
      if (this.isHarvesting) {
        nrvideo.Log.error("Harvesting is still in progress.");
        return;
      }

      if (this.eventBuffer.length === 0) {
        nrvideo.Log.error("No events in buffer to send.");
        this.startHarvestTimer();
        return;
      }

      this.isHarvesting = true;
      const eventsToSend = [...this.eventBuffer]; 
      this.eventBuffer = [];

      try {
        await this.fetchDataTokens();
        if (this.dataToken) {
          const response = await this.sendToMobileCollector(eventsToSend);
          console.log("Harvest successful. Response:", response);
        } else {
          throw new Error('Error in dataToken')
        }
      } catch (error) {
        nrvideo.Log.error("Harvest failed, re-queueing events. Error:", error.message);
        this.eventBuffer.unshift(...eventsToSend);
      } finally {
        this.isHarvesting = false;
        this.startHarvestTimer();
      }
    }
}
