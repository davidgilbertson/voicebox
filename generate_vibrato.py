import numpy as np
import wave
import struct

# Audio parameters
SAMPLE_RATE = 44100
DURATION = 10  # seconds
VIBRATO_RATE = 5  # Hz
VIBRATO_DEPTH_CENTS = 100  # cents (1 semitone)

# C3 frequency and semitone ratio
C3_HZ = 130.81  # C3
SEMITONE_RATIO = 2 ** (1/12)

# Generate samples
total_samples = SAMPLE_RATE * DURATION
samples = np.zeros(total_samples)

for i in range(total_samples):
    t = i / SAMPLE_RATE

    # Which second are we in? (0-9)
    second = int(t)

    # Base frequency: C3 + (second) semitones
    base_freq = C3_HZ * (SEMITONE_RATIO ** second)

    # Vibrato: modulate frequency by +/- 50 cents (100 cents total depth)
    # 100 cents = 1 semitone, so depth_ratio = 2^(cents/1200)
    vibrato_mod = np.sin(2 * np.pi * VIBRATO_RATE * t)
    cents_offset = vibrato_mod * (VIBRATO_DEPTH_CENTS / 2)
    freq = base_freq * (2 ** (cents_offset / 1200))

    # Generate sine wave with phase accumulation for smooth frequency changes
    # We need to integrate frequency to get phase
    pass

# Better approach: accumulate phase
phase = 0
for i in range(total_samples):
    t = i / SAMPLE_RATE
    second = int(t)

    base_freq = C3_HZ * (SEMITONE_RATIO ** second)
    vibrato_mod = np.sin(2 * np.pi * VIBRATO_RATE * t)
    cents_offset = vibrato_mod * (VIBRATO_DEPTH_CENTS / 2)
    freq = base_freq * (2 ** (cents_offset / 1200))

    samples[i] = np.sin(phase)
    phase += 2 * np.pi * freq / SAMPLE_RATE

# Apply fade in/out (10ms each - minimal to avoid pop)
fade_samples = int(0.01 * SAMPLE_RATE)
fade_in = np.linspace(0, 1, fade_samples)
fade_out = np.linspace(1, 0, fade_samples)
samples[:fade_samples] *= fade_in
samples[-fade_samples:] *= fade_out

# Normalize and convert to 16-bit
samples = samples / np.max(np.abs(samples)) * 0.8
samples_int = (samples * 32767).astype(np.int16)

# Write WAV file
with wave.open('vibrato_test.wav', 'w') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)  # 16-bit
    wav.setframerate(SAMPLE_RATE)
    wav.writeframes(samples_int.tobytes())

print(f"Generated vibrato_test.wav")
print(f"  Duration: {DURATION}s")
print(f"  Vibrato rate: {VIBRATO_RATE} Hz")
print(f"  Vibrato depth: {VIBRATO_DEPTH_CENTS} cents")
print(f"  Starting pitch: C3 ({C3_HZ:.2f} Hz)")
print(f"  Ending pitch: C4 ({C3_HZ * (SEMITONE_RATIO ** 9):.2f} Hz)")
