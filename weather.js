/* global WeatherProvider, WeatherUtils, formatTime */

Module.register("weather", {
	// Default module config.
	defaults: {
		weatherProvider: "openweathermap",
		roundTemp: false,
		type: "current", // current, forecast, daily (equivalent to forecast), hourly (only with OpenWeatherMap /onecall endpoint)
		lang: "vi",
		units: config.units,
		tempUnits: config.units,
		windUnits: config.units,
		timeFormat: config.timeFormat,
		updateInterval: 10 * 60 * 1000, // every 10 minutes
		animationSpeed: 1000,
		showFeelsLike: true,
		showHumidity: "none", // this is now a string; see current.njk
		showIndoorHumidity: false,
		showIndoorTemperature: false,
		allowOverrideNotification: false,
		showPeriod: true,
		showPeriodUpper: false,
		showPrecipitationAmount: false,
		showPrecipitationProbability: false,
		showUVIndex: false,
		showSun: true,
		showWindDirection: true,
		showWindDirectionAsArrow: false,
		degreeLabel: false,
		decimalSymbol: ".",
		maxNumberOfDays: 5,
		maxEntries: 5,
		ignoreToday: false,
		fade: true,
		fadePoint: 0.25, // Start on 1/4th of the list.
		initialLoadDelay: 0, // 0 seconds delay
		appendLocationNameToHeader: true,
		calendarClass: "calendar",
		tableClass: "small",
		onlyTemp: false,
		colored: false,
		absoluteDates: false,
		hourlyForecastIncrements: 1,

		chartType: "line",
		chartjsVersion: "3.9.1"
	},

	// Module properties.
	weatherProvider: null,
	chartData: {  // Biến chứa dữ liệu biểu đồ
		labels: [],
		datasets: [{
			label: "Temperature (°C)",
			data: [],
			borderColor: "rgb(75, 192, 192)",
			backgroundColor: "rgba(75, 192, 192, 0.2)",
			fill: false
		}]
	},
	chartVisible: false,
	showChart: false,
	chart: null,
	current_state: "hourly",
	minTemp: Number.POSITIVE_INFINITY, // Start with a very high value
    maxTemp: Number.NEGATIVE_INFINITY, // Start with a very low value

	// Can be used by the provider to display location of event if nothing else is specified
	firstEvent: null,

	// Define required scripts.
	getStyles () {
		return ["font-awesome.css", "weather-icons.css", "weather.css", "chart.css"];
	},

	// Return the scripts that are necessary for the weather module.
	getScripts () {
		let chartjsFileName = "chart.min.js";
        if (Number(this.config.chartjsVersion.split(".")[0]) < 3) {
            chartjsFileName = "Chart.min.js"
        }

		return ["https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.4/Chart.js",
			"moment.js", "weatherutils.js", "weatherobject.js", this.file("providers/overrideWrapper.js"), "weatherprovider.js", "suncalc.js", this.file(`providers/${this.config.weatherProvider.toLowerCase()}.js`)];
	},

	// Override getHeader method.
	getHeader () {
		if (this.config.appendLocationNameToHeader && this.weatherProvider) {
			if (this.data.header) return `${this.data.header} ${this.weatherProvider.fetchedLocation()}`;
			else return this.weatherProvider.fetchedLocation();
		}

		return this.data.header ? this.data.header : "";
	},

	// Start the weather module.
	start () {
		moment.locale(this.config.lang);

		if (this.config.useKmh) {
			Log.warn("Your are using the deprecated config values 'useKmh'. Please switch to windUnits!");
			this.windUnits = "kmh";
		} else if (this.config.useBeaufort) {
			Log.warn("Your are using the deprecated config values 'useBeaufort'. Please switch to windUnits!");
			this.windUnits = "beaufort";
		}
		if (typeof this.config.showHumidity === "boolean") {
			Log.warn("[weather] Deprecation warning: Please consider updating showHumidity to the new style (config string).");
			this.config.showHumidity = this.config.showHumidity ? "wind" : "none";
		}

		// Initialize the weather provider.
		this.weatherProvider = WeatherProvider.initialize(this.config.weatherProvider, this);

		// Let the weather provider know we are starting.
		this.weatherProvider.start();

		// Add custom filters
		this.addFilters();

		// Schedule the first update.
		this.scheduleUpdate(this.config.initialLoadDelay);

		this.chartVisible = false;
		this.createCanvas();

		console.log("showchart: ", this.showChart);
	},

	createCanvas: function () {
        // Remove existing canvas if present
        const existingCanvas = document.getElementById("weatherChart");
        if (existingCanvas) existingCanvas.remove();

        const canvas = document.createElement("canvas");
        canvas.id = "weatherChart";
        canvas.style.width = "100%";
    	canvas.style.height = "100%";

        const wrapper = document.getElementById("chartWrapper") || document.createElement("div");
        wrapper.id = "chartWrapper";
        wrapper.innerHTML = ""; // Clear any existing content

		wrapper.style.position = "fixed";
		wrapper.style.top = "0";
		wrapper.style.left = "0";
		wrapper.style.width = "100vw"; // Full viewport width
		wrapper.style.height = "100vh"; // Full viewport height
		wrapper.style.display = "none"; // Initially hidden
		wrapper.style.zIndex = "1000"; // To be on top of other content

        wrapper.appendChild(canvas);

        // Initially hide the wrapper
        wrapper.style.display = "block";

        document.body.appendChild(wrapper);
    },

	drawChart: function () {
        const ctx = document.getElementById("weatherChart").getContext("2d");

        if (this.chart) {
            // If chart exists, update its data
            this.chart.data = this.chartData;
            this.chart.update();
        } else {
            // Create a new chart if it doesn't exist
            this.chart = new Chart(ctx, {
                type: this.config.chartType, // Chart type (line or bar)
                data: this.chartData, // Data
                options: {
                    legend: {display: true},
					scales: {
					yAxes: [{ticks: {min: this.minTemp, max:min.maxTemp}}],
					}
                },
            });
        }
    },

	// Override notification handler.
	notificationReceived (notification, payload, sender) {
		if (notification === "CALENDAR_EVENTS") {
			const senderClasses = sender.data.classes.toLowerCase().split(" ");
			if (senderClasses.indexOf(this.config.calendarClass.toLowerCase()) !== -1) {
				this.firstEvent = null;
				for (let event of payload) {
					if (event.location || event.geo) {
						this.firstEvent = event;
						Log.debug("First upcoming event with location: ", event);
						break;
					}
				}
			}
		} else if (notification === "INDOOR_TEMPERATURE") {
			this.indoorTemperature = this.roundValue(payload);
			this.updateDom(300);
		} else if (notification === "INDOOR_HUMIDITY") {
			this.indoorHumidity = this.roundValue(payload);
			this.updateDom(300);
		} else if (notification === "CURRENT_WEATHER_OVERRIDE" && this.config.allowOverrideNotification) {
			this.weatherProvider.notificationReceived(payload);
		} else if (notification === "WEATHER_TOGGLE_FULL") {
			if (this.showChart){
				this.showChart = false; // Hide the chart
				this.current_state = "hourly";
            	document.getElementById("chartWrapper").style.display = "none"; // Hide canvas
			} else {
				this.showChart = true; // Show the chart
            	document.getElementById("chartWrapper").style.display = "block"; // Display canvas
			}
		} else if (notification === ("WEATHER_NEXT_PAGE" || "WEATHER_PREVIOUS_PAGE") ){
			if (this.current_state === "hourly"){
				this.current_state = "daily";
				this.updateChartData();
				this.drawChart();

			} else if (this.current_state === "daily"){
				this.current_state = "hourly";
				this.updateChartData();
				this.drawChart();
			}
		}
	},

	// Select the template depending on the display type.
	getTemplate () {
		switch (this.config.type.toLowerCase()) {
			case "current":
				return "current.njk";
			case "hourly":
				return "hourly.njk";
			case "daily":
			case "forecast":
				return "forecast.njk";
			//Make the invalid values use the "Loading..." from forecast
			default:
				return "forecast.njk";
		}
	},

	// Add all the data to the template.
	getTemplateData () {
		const currentData = this.weatherProvider.currentWeather();
		const forecastData = this.weatherProvider.weatherForecast();
		const hourlyData = this.weatherProvider.weatherHourly()?.filter((e, i) => (i + 1) % this.config.hourlyForecastIncrements === this.config.hourlyForecastIncrements - 1);

		console.log('current:', currentData);
		console.log('forecast:', forecastData);
		console.log('hourly:', hourlyData);	
		// Cập nhật chartData từ dữ liệu hourly
		this.chartData.labels = [];
		this.chartData.datasets[0].data = [];
		// Initialize chartData if not already initialized
		this.chartData = this.chartData || { labels: [], datasets: [{ data: [] }] };

		if(this.current_state === "hourly") {
			// Ensure hourlyData is defined and an array before iterating
			if (Array.isArray(hourlyData)) {
				hourlyData.slice(0, 5).forEach((entry) => {
					this.chartData.labels.push(formatTime(this.config, entry.date));
					this.chartData.datasets[0].data.push(entry.temperature);  // Use "temperature" from hourly data

					if(entry.maxTemperature > this.maxTemp)
						this.maxTemp = entry.maxTemperature;

					if(entry.mminTemperature < this.minTemp)
						this.minTemp = entry.minTemperature;
				});
			}
		} else if (this.current_state === "daily"){
			if (Array.isArray(forecastData)) {
				forecastData.slice(0, 5).forEach((entry) => {
					this.chartData.labels.push(this.formatDate(this.config, entry.date));
					this.chartData.datasets[0].data.push(entry.temperature);  // Use "temperature" from hourly data
				});
			}
		}
		

		console.log('Date: ', this.chartData.labels);
		console.log('Temp: ', this.chartData.datasets[0].data);

		// console.log("Saved data: ", this.chartData);

		return {
			config: this.config,
			current: currentData,
			forecast: forecastData,
			hourly: hourlyData,
			chartData: this.chartData,  // Truyền dữ liệu chart vào template
			indoor: {
				humidity: this.indoorHumidity,
				temperature: this.indoorTemperature
			}
		};
	},

	formatDate:function(config, dateString) {
		const date = new Date(dateString);
		// Adjust the format based on your region's preference
		const options = { month: '2-digit', day: '2-digit' }; // e.g., "MM/DD"
		return date.toLocaleDateString(config.locale || 'vi-VN', options);
	},
	
	

	// What to do when the weather provider has new information available?
	updateAvailable () {
		Log.log("New weather information available.");
		this.updateDom(0);
		this.scheduleUpdate();
		// this.createCanvas();
		

		if (this.weatherProvider.currentWeather()) {
			this.sendNotification("CURRENTWEATHER_TYPE", { type: this.weatherProvider.currentWeather().weatherType.replace("-", "_") });
		}

		const notificationPayload = {
			currentWeather: this.config.units === "imperial"
				? WeatherUtils.convertWeatherObjectToImperial(this.weatherProvider?.currentWeatherObject?.simpleClone()) ?? null
				: this.weatherProvider?.currentWeatherObject?.simpleClone() ?? null,
			forecastArray: this.config.units === "imperial"
				? this.weatherProvider?.weatherForecastArray?.map((ar) => WeatherUtils.convertWeatherObjectToImperial(ar.simpleClone())) ?? []
				: this.weatherProvider?.weatherForecastArray?.map((ar) => ar.simpleClone()) ?? [],
			hourlyArray: this.config.units === "imperial"
				? this.weatherProvider?.weatherHourlyArray?.map((ar) => WeatherUtils.convertWeatherObjectToImperial(ar.simpleClone())) ?? []
				: this.weatherProvider?.weatherHourlyArray?.map((ar) => ar.simpleClone()) ?? [],
			locationName: this.weatherProvider?.fetchedLocationName,
			providerName: this.weatherProvider.providerName
		};
		
		console.log("Drawing");
		// this.createCanvas();
		// document.getElementById("chartWrapper").style.display = "block"; // Display canvas
		this.drawChart();
		this.sendNotification("WEATHER_UPDATED", notificationPayload);
	},

	scheduleUpdate (delay = null) {
		let nextLoad = this.config.updateInterval;
		if (delay !== null && delay >= 0) {
			nextLoad = delay;
		}

		this.updateChartData();

		this.updateInterval = setInterval(() => {
			console('Drawing');
            this.updateChartData(); // Update chart data
            if (this.showChart) {
                this.drawChart(); // Draw chart if it's visible
				
            }
        }, this.config.updateInterval);

		setTimeout(() => {
			
			// console.log("Fetch current success");
			// this.weatherProvider.fetchCurrentWeather();

			switch (this.config.type.toLowerCase()) {
				case "current":
					this.weatherProvider.fetchCurrentWeather();
					break;
				case "hourly":
					this.weatherProvider.fetchWeatherHourly();
					break;
				case "daily":
				case "forecast":
					this.weatherProvider.fetchWeatherForecast();
					console.log("Fectch hourly success");
					this.weatherProvider.fetchWeatherHourly();
					break;
				default:
					Log.error(`Invalid type ${this.config.type} configured (must be one of 'current', 'hourly', 'daily' or 'forecast')`);
			}
		}, nextLoad);

		if (this.updateInterval) clearInterval(this.updateInterval); // Clear any previous intervals

	},

	updateChartData: function () {
        const data = this.getTemplateData(); // Get new data
        this.chartData = data.chartData; // Update chart data
    },

	roundValue (temperature) {
		const decimals = this.config.roundTemp ? 0 : 1;
		const roundValue = parseFloat(temperature).toFixed(decimals);
		return roundValue === "-0" ? 0 : roundValue;
	},

	addFilters () {
		this.nunjucksEnvironment().addFilter(
			"formatTime",
			function (date) {
				return formatTime(this.config, date);
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"unit",
			function (value, type, valueUnit) {
				let formattedValue;
				if (type === "temperature") {
					formattedValue = `${this.roundValue(WeatherUtils.convertTemp(value, this.config.tempUnits))}°`;
					if (this.config.degreeLabel) {
						if (this.config.tempUnits === "metric") {
							formattedValue += "C";
						} else if (this.config.tempUnits === "imperial") {
							formattedValue += "F";
						} else {
							formattedValue += "K";
						}
					}
				} else if (type === "precip") {
					if (value === null || isNaN(value)) {
						formattedValue = "";
					} else {
						formattedValue = WeatherUtils.convertPrecipitationUnit(value, valueUnit, this.config.units);
					}
				} else if (type === "humidity") {
					formattedValue = `${value}%`;
				} else if (type === "wind") {
					formattedValue = WeatherUtils.convertWind(value, this.config.windUnits);
				}
				return formattedValue;
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"roundValue",
			function (value) {
				return this.roundValue(value);
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"decimalSymbol",
			function (value) {
				return value.toString().replace(/\./g, this.config.decimalSymbol);
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"calcNumSteps",
			function (forecast) {
				return Math.min(forecast.length, this.config.maxNumberOfDays);
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"calcNumEntries",
			function (dataArray) {
				return Math.min(dataArray.length, this.config.maxEntries);
			}.bind(this)
		);

		this.nunjucksEnvironment().addFilter(
			"opacity",
			function (currentStep, numSteps) {
				if (this.config.fade && this.config.fadePoint < 1) {
					if (this.config.fadePoint < 0) {
						this.config.fadePoint = 0;
					}
					const startingPoint = numSteps * this.config.fadePoint;
					const numFadesteps = numSteps - startingPoint;
					if (currentStep >= startingPoint) {
						return 1 - (currentStep - startingPoint) / numFadesteps;
					} else {
						return 1;
					}
				} else {
					return 1;
				}
			}.bind(this)
		);
	}
});
