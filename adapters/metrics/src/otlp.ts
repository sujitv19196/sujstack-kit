import type { Counter as OtelCounter } from "@opentelemetry/api"
import {
  AggregationTemporalityPreference,
  OTLPMetricExporter,
} from "@opentelemetry/exporter-metrics-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import type { Catalog, CounterRecord, MetricSink } from "@sujstack/metrics-core"

export interface OtlpOptions {
  /** Base URL, as in `OTEL_EXPORTER_OTLP_ENDPOINT`; `/v1/metrics` is appended. */
  readonly endpoint: string
  readonly headers: Readonly<Record<string, string>>
  readonly serviceName: string
  readonly exportIntervalMillis: number
}

/** Parses the `OTEL_EXPORTER_OTLP_HEADERS` format: `k1=v1,k2=v2`, values URL-encoded. */
export function parseOtlpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of raw.split(",")) {
    const at = pair.indexOf("=")
    if (at <= 0) continue
    headers[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1).trim())
  }
  return headers
}

export function createOtlpSink(options: OtlpOptions, counters: Catalog): MetricSink {
  const exporter = new OTLPMetricExporter({
    url: `${options.endpoint.replace(/\/$/, "")}/v1/metrics`,
    headers: { ...options.headers },
    temporalityPreference: AggregationTemporalityPreference.CUMULATIVE,
  })
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      // Cumulative series from two instances must not collide; this becomes the `instance` label.
      "service.instance.id": crypto.randomUUID(),
    }),
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: options.exportIntervalMillis,
      }),
    ],
  })
  const meter = provider.getMeter("sujstack")

  const instruments = new Map<string, OtelCounter>()
  for (const counter of Object.values(counters)) {
    instruments.set(
      counter.name,
      meter.createCounter(counter.name, { description: counter.description }),
    )
  }

  return {
    add(record: CounterRecord): void {
      instruments.get(record.name)?.add(record.value, record.labels)
    },
  }
}
