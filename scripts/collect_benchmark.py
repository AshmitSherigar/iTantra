#!/usr/bin/env python3
"""
iTantra Automated Telemetry Harvester
Connects to one or two devices via ADB, captures structured logcat events with tag ITANTRA_BENCHMARK,
and exports them to CSV.
"""

import subprocess
import threading
import csv
import sys
import json

def stream_device_logs(device_serial, output_file, stop_event):
    cmd = ["adb"]
    if device_serial:
        cmd.extend(["-s", device_serial])
    # React Native console.log lines are tagged by the RN JS runtime, not by
    # our marker. Filter the message body below instead of filtering log tags.
    cmd.extend(["logcat", "-v", "raw"])
    
    print(f"[{device_serial or 'default'}] Starting logcat stream -> {output_file}")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    
    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["monotonic_nanos", "epoch_millis", "trace_id", "stage", "seq", "chars", "bytes", "extra", "metadata_json"])
        
        try:
            for line in proc.stdout:
                if stop_event.is_set():
                    break
                marker = "ITANTRA_BENCHMARK:"
                if marker not in line:
                    continue
                payload = line.split(marker, 1)[1].strip()
                try:
                    event = json.loads(payload)
                    writer.writerow([
                        event.get("timestampNanos", ""),
                        event.get("timestampMillis", ""),
                        event.get("traceId", ""),
                        event.get("stage", ""),
                        event.get("seqIndex", -1),
                        event.get("charCount", -1),
                        event.get("byteCount", -1),
                        event.get("extraInfo", ""),
                        json.dumps(event.get("metadata", {}), ensure_ascii=False),
                    ])
                except (json.JSONDecodeError, TypeError):
                    # Backward compatibility with earlier comma-delimited logs.
                    parts = payload.split(",")
                    if len(parts) >= 4:
                        writer.writerow(parts[:8] + ["{}"])
                f.flush()
        finally:
            proc.terminate()

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 collect_benchmark.py <OUTPUT_CSV> [DEVICE_SERIAL_A] [DEVICE_SERIAL_B]")
        print("Example 1: python3 collect_benchmark.py run_single.csv")
        print("Example 2: python3 collect_benchmark.py devA.csv emulator-5554")
        print("Example 3: python3 collect_benchmark.py out.csv dev1_serial dev2_serial")
        sys.exit(1)

    out_file = sys.argv[1]
    dev_a = sys.argv[2] if len(sys.argv) > 2 else None
    dev_b = sys.argv[3] if len(sys.argv) > 3 else None

    stop_event = threading.Event()

    threads = []
    if dev_b:
        t1 = threading.Thread(target=stream_device_logs, args=(dev_a, f"tx_{out_file}", stop_event))
        t2 = threading.Thread(target=stream_device_logs, args=(dev_b, f"rx_{out_file}", stop_event))
        threads.extend([t1, t2])
    else:
        t1 = threading.Thread(target=stream_device_logs, args=(dev_a, out_file, stop_event))
        threads.append(t1)

    for t in threads:
        t.start()

    print("\n[iTantra] Telemetry listener active. Press Ctrl+C to finish recording.\n")
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("\nStopping capture...")
        stop_event.set()
        for t in threads:
            t.join(timeout=2)
        print("Telemetry capture successfully saved.")

if __name__ == "__main__":
    main()
