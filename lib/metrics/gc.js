'use strict';
const Histogram = require('../histogram');

let perf_hooks;

try {
	// eslint-disable-next-line
	perf_hooks = require('perf_hooks');
} catch {
	// node version is too old
}

const NODEJS_GC_DURATION_SECONDS = 'nodejs_gc_duration_seconds';
const DEFAULT_GC_DURATION_BUCKETS = [0.001, 0.01, 0.1, 1, 2, 5];

const NODEJS_GC_DISTANCE_SECONDS = 'nodejs_gc_distance_seconds';
const DEFAULT_GC_DISTANCE_BUCKETS = [0.05, 0.1, 0.5, 1, 2, 3, 4, 5, 10, 15, 20, 30, 60];

const kinds = [];

if (perf_hooks && perf_hooks.constants) {
	kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_MAJOR] = 'major';
	kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_MINOR] = 'minor';
	kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_INCREMENTAL] = 'incremental';
	kinds[perf_hooks.constants.NODE_PERFORMANCE_GC_WEAKCB] = 'weakcb';
}

module.exports = (registry, config = {}) => {
	if (!perf_hooks) {
		return;
	}

	const namePrefix = config.prefix ? config.prefix : '';
	const labels = config.labels ? config.labels : {};
	const labelNames = Object.keys(labels);
	const buckets = config.gcDurationBuckets
		? config.gcDurationBuckets
		: DEFAULT_GC_DURATION_BUCKETS;
	const gcHistogram = new Histogram({
		name: namePrefix + NODEJS_GC_DURATION_SECONDS,
		help: 'Garbage collection duration by kind, one of major, minor, incremental or weakcb.',
		labelNames: ['kind', ...labelNames],
		enableExemplars: false,
		buckets,
		registers: registry ? [registry] : undefined,
	});

	const gcDistanceHistogram = new Histogram({
		name: namePrefix + NODEJS_GC_DISTANCE_SECONDS,
		help: 'Seconds between garbage collections by kind, one of major, minor, incremental or weakcb.',
		labelNames: ['kind', ...labelNames],
		enableExemplars: false,
		buckets: config.gcDistanceBuckets ? config.gcDistanceBuckets : DEFAULT_GC_DISTANCE_BUCKETS,
		registers: registry ? [registry] : undefined,
	});

	const last = {};
	const obs = new perf_hooks.PerformanceObserver(list => {
		const entries = list.getEntries();
		const first = {};
		entries.forEach(entry => {
			// Node < 16 uses entry.kind
			// Node >= 16 uses entry.detail.kind
			// See: https://nodejs.org/docs/latest-v16.x/api/deprecations.html#deprecations_dep0152_extension_performanceentry_properties
			const kind = entry.detail ? kinds[entry.detail.kind] : kinds[entry.kind];
			// Convert duration from milliseconds to seconds
			gcHistogram.observe(Object.assign({ kind }, labels), entry.duration / 1000);

			if (!first[kind]) {
				first[kind] = entry.startTime;
				if (last[kind]) {
					const distance = entry.startTime - last[kind]
					gcDistanceHistogram.observe(Object.assign({ kind }, labels), distance / 1000);
				}
			}
		});
		Object.assign(last, first);
	});

	obs.observe({ entryTypes: ['gc'] });
};

module.exports.metricNames = [NODEJS_GC_DURATION_SECONDS];
