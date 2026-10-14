# Data Dictionary — Sit-to-Stand Biomechanics Lab

App 1.0.0 · analysis 1.0.0 · schema 1.0. **Generated** from `schema.js` and `config.js` — do not edit by hand; run `node tools/build-dictionary.js`.

## 1. Conventions

- **Time** `t = 0` is the "Go" signal. Negative times are the pre-roll (seated, before Go). Times in seconds unless a column ends `_ms`.
- **Image coordinates** MediaPipe normalised x (0 left → 1 right) and y (0 top → 1 bottom) of the video frame; `z` is relative depth (smaller = nearer the camera, scale ≈ x). Raw x/y are of the *un-mirrored* video, regardless of on-screen mirroring.
- **Vertical quantities** reported positive **upward** (image y is flipped). Angles in degrees. `null`/empty = not computable.
- **World landmarks** metres, origin at the hip midpoint, axes per MediaPipe (x right, y down, z toward camera). Used only as a 3D cross-check of the 2D angles.
- **Sagittal (side-on) view assumed.** The dominant (camera-near) side is chosen at calibration by landmark visibility; the facing direction `d` (±1) is derived from knee/foot position relative to the hip.
- **Sign conventions** knee flexion 0° = fully extended; hip flexion 0° = trunk and thigh collinear; trunk inclination 0° = vertical, **positive = leaning forward** (toward facing direction); shank inclination 0° = vertical, positive = knee forward of ankle.
- Booleans export as `TRUE`/`FALSE` in CSV.

## 2. Summary table (`Sessions` sheet / `*_summary.csv`) — one row per test


**Session & participant**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 1 | `session_id` | string | - | Unique session identifier (UUID v4) created in the browser. Links the Sessions, Reps and Frames sheets; used to de-duplicate re-sent uploads. | crypto.randomUUID() |
| 2 | `timestamp_utc` | datetime | ISO 8601 (UTC) | Moment the analysis was completed. | new Date().toISOString() |
| 3 | `utc_offset_min` | integer | min | Local time-zone offset from UTC at test time (local = UTC + offset). | -new Date().getTimezoneOffset() |
| 4 | `app_version` | string | - | Application version. | CONFIG.app.version |
| 5 | `analysis_version` | string | - | Version of the analysis algorithms. Changes whenever a metric definition or threshold logic changes. | CONFIG.app.analysisVersion |
| 6 | `schema_version` | string | - | Version of this data schema. | CONFIG.app.schemaVersion |
| 7 | `participant_id` | string | - | Pseudonymous participant code entered by the operator. Do not enter real names. | Operator input |
| 8 | `age_years` | integer | years | Participant age at test. | Operator input |
| 9 | `sex` | categorical | male \| female \| other | Sex used only for the STEADI normative lookup (the published table is male/female). | Operator input |
| 10 | `height_cm` | number | cm | Standing height. Used to convert pixels to metres (see scale_m_per_px). | Operator input (measured) |
| 11 | `body_mass_kg` | number | kg | Body mass (optional). Only used for work_rate_proxy_w. | Operator input |
| 12 | `chair_seat_height_cm` | number | cm | Seat height of the chair used (STEADI standard 43.2 cm = 17 in). Recorded for covariate use; not used in calculations. | Operator input |
| 13 | `site` | string | - | Free-text collection site / session label. | Operator input |
| 14 | `operator_notes` | string | - | Free-text notes. Do not enter identifying information. | Operator input |

**Device & pose model**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 15 | `pose_model` | categorical | lite \| full \| heavy | MediaPipe Pose Landmarker variant used. | Operator selection |
| 16 | `pose_delegate` | categorical | GPU \| CPU | Inference delegate actually used (GPU falls back to CPU if unavailable). | MediaPipe initialisation |
| 17 | `camera_facing` | categorical | environment \| user | Camera used: rear (environment) or front/webcam (user). | Operator selection |
| 18 | `video_width_px` | integer | px | Width of the video stream analysed. | HTMLVideoElement.videoWidth |
| 19 | `video_height_px` | integer | px | Height of the video stream analysed. | HTMLVideoElement.videoHeight |
| 20 | `user_agent` | string | - | Browser user-agent string (truncated to 200 characters). | navigator.userAgent |

**Protocol**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 21 | `planned_duration_s` | number | s | Planned test duration (30 s). | CONFIG.protocol.durationS |
| 22 | `test_duration_s` | number | s | Duration actually run, capped at the planned duration. Less than planned if the operator stopped early. | min(elapsed, planned) |
| 23 | `manual_stop` | boolean | - | True if the operator stopped the test before the planned duration. |  |
| 24 | `arms_crossed_confirmed` | boolean | - | Operator confirmed the participant was instructed to keep arms crossed on the chest (CDC protocol). | Operator checkbox |
| 25 | `filter_cutoff_hz` | number | Hz | Effective -3 dB cutoff of the zero-lag low-pass filter applied to landmark coordinates. | CONFIG.signal.cutoffHz |
| 26 | `resample_hz` | number | Hz | Uniform sampling rate of the analysed time series. | CONFIG.signal.resampleHz |

**Primary outcomes**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 27 | `stands_count` | integer | stands | Number of full stands in the test window (CDC 30-s chair stand score). Offline, zero-lag analysis. A rise counts when its 50 %-progress crossing is within the window AND it reached full stand (peak progress >= fullStandProgress and knee extension criterion) OR is still rising at the end (half-way rule). | Offline event detection (see Definitions) |
| 28 | `live_count` | integer | stands | Count shown live during the test (causal, simple thresholds). Recorded to audit the offline count. | Live state machine |
| 29 | `count_difference` | integer | stands | stands_count minus live_count. Non-zero indicates the live display was wrong. | stands_count - live_count |
| 30 | `half_rule_applied` | boolean | - | True if at least one stand was counted under the CDC half-way rule (more than halfway up when time expired). |  |
| 31 | `incomplete_attempts` | integer | attempts | Rises that passed the attempt threshold (progress >= stateHi) inside the window but were not counted (did not reach full stand). |  |
| 32 | `stands_first_half` | integer | stands | Counted stands whose 50 %-progress crossing occurred in the first half of the test (t <= 15 s). |  |
| 33 | `stands_second_half` | integer | stands | Counted stands whose 50 %-progress crossing occurred in the second half (t > 15 s). |  |
| 34 | `norm_reference` | string | - | Normative table used for classification. | CONFIG.steadi.reference |
| 35 | `norm_cutoff_below_average` | integer | stands | STEADI cut-point for the participant's age/sex: fewer stands than this = below average. Null if age outside 60-94 or sex not male/female. | Table lookup |
| 36 | `norm_classification` | categorical | - | "Below average", "Average or above", or "Not classified" (age/sex outside table, or the session failed protocol/QC checks - see valid_for_norm). | stands_count vs cut-point, only if valid_for_norm |

**Temporal metrics**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 37 | `time_to_first_stand_s` | number | s | Time from "Go" until the first counted rep reaches standing (includes reaction time). | t_standing_s of first counted rep |
| 38 | `cycle_time_mean_s` | number | s | Mean interval between consecutive movement onsets (counted reps). | mean(cycle_time_s) |
| 39 | `cycle_time_sd_s` | number | s | Sample standard deviation (n-1) of cycle time. |  |
| 40 | `cycle_time_cv_pct` | number | % | Coefficient of variation of cycle time = SD / mean x 100. Pacing consistency. |  |
| 41 | `cycle_time_min_s` | number | s | Shortest cycle time. |  |
| 42 | `cycle_time_max_s` | number | s | Longest cycle time. |  |
| 43 | `cycle_time_slope_s_per_rep` | number | s/rep | Least-squares slope of cycle time against rep number (fatigue/slowing trend). Null if fewer than 4 cycles. | OLS |
| 44 | `cycle_time_change_pct` | number | % | Change in mean cycle time from first third to last third of reps (positive = slowing). Null if fewer than 6 counted reps. | (mean last third - mean first third) / mean first third x 100 |
| 45 | `ascent_time_mean_s` | number | s | Mean ascent duration (10 % to 90 % of hip excursion). |  |
| 46 | `ascent_time_sd_s` | number | s | Sample SD of ascent duration. |  |
| 47 | `standing_dwell_mean_s` | number | s | Mean time spent at the top (90 % up to 90 % down). |  |
| 48 | `descent_time_mean_s` | number | s | Mean descent duration (90 % to 10 % of hip excursion). |  |
| 49 | `descent_time_sd_s` | number | s | Sample SD of descent duration. |  |
| 50 | `seated_dwell_mean_s` | number | s | Mean time between seat contact and next movement onset. |  |

**Hip (pelvis-proxy) kinematics**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 51 | `hip_rise_mean_m` | number | m | Mean vertical rise of the hip marker from onset to standing. Requires correct height entry for metric accuracy. | Δy x scale_m_per_px |
| 52 | `peak_ascent_velocity_mean_m_s` | number | m/s | Mean of per-rep peak upward hip velocity. | Central-difference derivative of filtered hip height |
| 53 | `peak_ascent_velocity_sd_m_s` | number | m/s | Sample SD of per-rep peak ascent velocity. |  |
| 54 | `peak_ascent_velocity_max_m_s` | number | m/s | Highest peak ascent velocity of any counted rep. |  |
| 55 | `ascent_mean_velocity_mean_m_s` | number | m/s | Mean of per-rep average ascent velocity (hip rise 10 %-90 % divided by ascent time). |  |
| 56 | `peak_descent_velocity_mean_m_s` | number | m/s | Mean of per-rep peak downward hip speed (positive number). |  |
| 57 | `ascent_velocity_change_pct` | number | % | Change in mean peak ascent velocity from first third to last third of reps (negative = slowing). Null if fewer than 6 counted reps. |  |
| 58 | `work_rate_proxy_mean_w` | number | W | Mean of body mass x g x hip rise / ascent time. A crude vertical work-rate PROXY for the whole-body centre of mass; not validated mechanical power. Null if body mass not entered. | m x 9.81 x Δh / t_ascent |

**Joint & segment kinematics (sagittal plane, side view)**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 59 | `knee_flex_seated_mean_deg` | number | deg | Mean knee flexion at movement onset (0 = straight leg). |  |
| 60 | `knee_flex_standing_mean_deg` | number | deg | Mean knee flexion while standing at the top. |  |
| 61 | `knee_rom_mean_deg` | number | deg | Mean knee range of motion used in the ascent (onset minus standing). |  |
| 62 | `knee_ext_peak_velocity_mean_deg_s` | number | deg/s | Mean of per-rep peak knee extension angular velocity. |  |
| 63 | `hip_flex_seated_mean_deg` | number | deg | Mean hip flexion (trunk-thigh angle complement) at onset (0 = trunk and thigh collinear). |  |
| 64 | `hip_flex_standing_mean_deg` | number | deg | Mean hip flexion while standing. |  |
| 65 | `hip_ext_peak_velocity_mean_deg_s` | number | deg/s | Mean of per-rep peak hip extension angular velocity. |  |
| 66 | `trunk_lean_peak_mean_deg` | number | deg | Mean of per-rep peak forward trunk inclination from vertical during the ascent (momentum/leaning strategy). |  |
| 67 | `trunk_lean_peak_max_deg` | number | deg | Largest peak trunk inclination of any counted rep. |  |
| 68 | `trunk_incl_standing_mean_deg` | number | deg | Mean trunk inclination from vertical while standing (0 = upright; positive = forward). |  |
| 69 | `shank_incl_peak_mean_deg` | number | deg | Mean of per-rep peak shank inclination (knee forward of ankle) during the ascent. |  |
| 70 | `ankle_angle_range_mean_deg` | number | deg | EXPLORATORY. Mean range of the knee-ankle-toe angle during ascent. Foot landmarks are the least reliable markers. |  |

**Calibration**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 71 | `dominant_side` | categorical | left \| right | Body side nearest the camera, whose markers drive all kinematics (chosen by mean visibility during calibration). |  |
| 72 | `facing_direction` | categorical | left \| right | Direction the participant faces in the image (from knee position relative to hip while seated). Defines the sign of trunk/shank inclination. |  |
| 73 | `scale_m_per_px` | number | m/px | Metres per image pixel at the participant's plane: 0.779 x height / pixel length of the shoulder-hip-knee-ankle chain in the standing calibration. | Winter (2009) chain fraction |
| 74 | `scale_check_diff_pct` | number | % | Percent difference between the median chain length during the test and during standing calibration. Large values = foreshortening or camera/participant movement. |  |
| 75 | `calib_chain_px` | number | px | Pixel length of the shoulder-hip-knee-ankle chain in the standing calibration. |  |
| 76 | `calib_hip_rise_m` | number | m | Hip rise between seated and standing calibration (scaled). Plausibility check on height entry and calibration. |  |
| 77 | `calib_standing_knee_flex_deg` | number | deg | Knee flexion in the standing calibration. |  |
| 78 | `calib_seated_knee_flex_deg` | number | deg | Knee flexion in the seated calibration. |  |
| 79 | `calib_standing_trunk_incl_deg` | number | deg | Trunk inclination in the standing calibration. |  |
| 80 | `calib_shank_from_vertical_deg` | number | deg | Absolute shank inclination in the standing calibration. Large values suggest camera tilt. |  |
| 81 | `calib_seated_arm_dev` | number | trunk lengths | Wrist-to-shoulder-midpoint distance in the seated calibration (arms crossed baseline). |  |

**Quality control**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 82 | `effective_fs_hz` | number | Hz | Frames analysed by the pose model per second in the test window (detector throughput). | attempted frames / window duration |
| 83 | `valid_frame_pct` | number | % | Percentage of analysed frames in which shoulder, hip, knee and ankle were all confidently detected. |  |
| 84 | `imputed_sample_pct` | number | % | Percentage of resampled time-series samples that lie in a tracking gap longer than maxGapS (bridged by interpolation). |  |
| 85 | `longest_gap_s` | number | s | Longest interval without a confident detection of the full dominant chain in the test window. |  |
| 86 | `median_chain_visibility` | number | 0-1 | Median of the mean MediaPipe visibility score of the four chain landmarks. |  |
| 87 | `view_obliquity_median` | number | trunk lengths | Median \|left hip x - right hip x\| / trunk length. ~0 when the camera is perpendicular to the sagittal plane; larger = oblique view. |  |
| 88 | `knee_2d_3d_diff_deg` | number | deg | Mean absolute difference between 2D image knee flexion and 3D (world-landmark) knee flexion. Cross-check of view alignment. |  |
| 89 | `ankle_shift_shank_frac` | number | shank lengths | Shift of the median ankle y during the test from the standing calibration, in shank lengths. Detects camera movement or feet sliding. |  |
| 90 | `arm_use_reps` | integer | reps | Counted reps in which arm use (wrists leaving the chest) was suspected. |  |
| 91 | `qc_flags` | string | ; separated | Codes of all QC conditions triggered (see Definitions). |  |
| 92 | `qc_pass` | boolean | - | True if no BLOCKING QC flag was raised. |  |
| 93 | `valid_for_norm` | boolean | - | True if the session may be compared with CDC norms: qc_pass, full duration, arms-crossed confirmed, age 60-94, sex male/female. |  |

## 3. Rep table (`Reps` sheet / `*_reps.csv`) — one row per detected stand attempt


**Identity**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 1 | `session_id` | string | - | Links to the Sessions sheet. |  |
| 2 | `rep_index` | integer | - | Order of the detected rise within the test window (all attempts, 1-based). |  |
| 3 | `stand_number` | integer | - | Running number of COUNTED stands (null if not counted). |  |
| 4 | `counted` | boolean | - | Whether this rise contributes to stands_count. |  |
| 5 | `counted_by_half_rule` | boolean | - | Counted only because it was more than halfway up when time expired. |  |
| 6 | `full_stand_hip` | boolean | - | Peak hip progress >= fullStandProgress. |  |
| 7 | `full_stand_knee` | boolean | - | Knee flexion at standing <= calibrated standing knee flexion + tolerance. |  |

**Event times (s from Go)**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 8 | `t_onset_s` | number | s | Movement onset: hip progress leaves the seated level (10 % of the rep's hip excursion). |  |
| 9 | `t_half_s` | number | s | Time progress crosses 50 % (used for the counting window and CDC half-way rule). |  |
| 10 | `t_standing_s` | number | s | Standing reached: 90 % of the rep's hip excursion. |  |
| 11 | `t_descent_start_s` | number | s | Descent begins: hip falls below 90 % of the excursion. |  |
| 12 | `t_seat_contact_s` | number | s | Seat contact: hip returns to within 10 % of the seated level. |  |

**Phase durations (s)**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 13 | `ascent_time_s` | number | s | Onset to standing (10-90 %). |  |
| 14 | `standing_dwell_s` | number | s | Standing to descent start. |  |
| 15 | `descent_time_s` | number | s | Descent start to seat contact. |  |
| 16 | `seated_dwell_s` | number | s | Seat contact to the next rep's onset. |  |
| 17 | `cycle_time_s` | number | s | Onset to next rep's onset (null for the last rep). |  |

**Hip kinematics**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 18 | `peak_progress` | number | 0-1 | Highest hip progress reached (1 = calibrated standing height). |  |
| 19 | `hip_rise_m` | number | m | Hip vertical rise from onset to standing. |  |
| 20 | `peak_ascent_velocity_m_s` | number | m/s | Maximum upward hip velocity during the rise. |  |
| 21 | `time_to_peak_velocity_s` | number | s | Time from onset to peak ascent velocity. |  |
| 22 | `ascent_mean_velocity_m_s` | number | m/s | Hip rise divided by ascent time. |  |
| 23 | `peak_descent_velocity_m_s` | number | m/s | Maximum downward hip speed (positive). |  |
| 24 | `work_rate_proxy_w` | number | W | m x 9.81 x hip rise / ascent time (null if no body mass). Proxy only. |  |

**Joint & segment kinematics**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 25 | `knee_flex_onset_deg` | number | deg | Knee flexion at onset. |  |
| 26 | `knee_flex_standing_deg` | number | deg | Median knee flexion while standing. |  |
| 27 | `knee_rom_deg` | number | deg | Onset minus standing knee flexion. |  |
| 28 | `knee_ext_peak_velocity_deg_s` | number | deg/s | Peak knee extension angular velocity in the ascent. |  |
| 29 | `hip_flex_onset_deg` | number | deg | Hip flexion at onset. |  |
| 30 | `hip_flex_standing_deg` | number | deg | Median hip flexion while standing. |  |
| 31 | `hip_ext_peak_velocity_deg_s` | number | deg/s | Peak hip extension angular velocity in the ascent. |  |
| 32 | `trunk_incl_onset_deg` | number | deg | Trunk inclination from vertical at onset (positive = forward). |  |
| 33 | `trunk_lean_peak_deg` | number | deg | Peak forward trunk inclination during the ascent. |  |
| 34 | `trunk_incl_standing_deg` | number | deg | Median trunk inclination while standing. |  |
| 35 | `shank_incl_peak_deg` | number | deg | Peak shank inclination (knee anterior to ankle) in the ascent. |  |
| 36 | `ankle_angle_range_deg` | number | deg | EXPLORATORY. Range of knee-ankle-toe angle in the ascent. |  |

**Protocol & tracking flags**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 37 | `arm_dev_max` | number | trunk lengths | Largest increase of wrist-to-chest distance above the seated baseline during the ascent window. |  |
| 38 | `arm_use_flag` | categorical | no \| suspected \| unavailable | Arm-use screening result; "unavailable" when wrists were not visible. |  |
| 39 | `tracking_gap_flag` | boolean | - | A tracking gap longer than maxGapS overlaps this rep. |  |

## 4. Analysed time series (`*_frames_analysis.csv`, optional `Frames` sheet) — uniform 30 Hz


**Time series (uniform grid, filtered)**

| # | Column | Type | Unit | Description | Calculation / source |
|---|---|---|---|---|---|
| 1 | `session_id` | string | - | Links to the Sessions sheet. |  |
| 2 | `t_s` | number | s | Time relative to "Go" (negative = pre-roll). |  |
| 3 | `phase` | categorical | SEATED \| ASCENT \| STANDING \| DESCENT | Movement phase from the event detection (only reps in the table are labelled). |  |
| 4 | `tracking_gap` | integer | 0/1 | 1 if the sample lies in a tracking gap longer than maxGapS. |  |
| 5 | `progress` | number | 0-1+ | Hip progress p(t): 0 = seated baseline, 1 = calibrated standing hip height. |  |
| 6 | `hip_up_m` | number | m | Hip height above the seated baseline. |  |
| 7 | `hip_vel_m_s` | number | m/s | Vertical hip velocity (positive = rising). |  |
| 8 | `knee_flex_deg` | number | deg | Knee flexion, 2D sagittal. |  |
| 9 | `knee_vel_deg_s` | number | deg/s | Knee flexion angular velocity (negative = extending). |  |
| 10 | `hip_flex_deg` | number | deg | Hip flexion (trunk-thigh), 2D sagittal. |  |
| 11 | `hip_flex_vel_deg_s` | number | deg/s | Hip flexion angular velocity. |  |
| 12 | `trunk_incl_deg` | number | deg | Trunk inclination from vertical (positive = forward). |  |
| 13 | `shank_incl_deg` | number | deg | Shank inclination from vertical (positive = knee forward of ankle). |  |
| 14 | `ankle_angle_deg` | number | deg | Knee-ankle-toe included angle (exploratory). |  |
| 15 | `knee_flex_3d_deg` | number | deg | Knee flexion from MediaPipe world landmarks (cross-check). |  |
| 16 | `hip_flex_3d_deg` | number | deg | Hip flexion from MediaPipe world landmarks (cross-check). |  |
| 17 | `arm_dev` | number | trunk lengths | Mean wrist distance from shoulder midpoint / seated trunk length. |  |
| 18 | `obliquity` | number | trunk lengths | \|left hip x - right hip x\| / trunk length. |  |
| 19 | `sh_x_px` | number | px | Filtered dominant shoulder x. |  |
| 20 | `sh_y_px` | number | px | Filtered dominant shoulder y (image coordinates, down = larger). |  |
| 21 | `hip_x_px` | number | px | Filtered dominant hip x. |  |
| 22 | `hip_y_px` | number | px | Filtered dominant hip y. |  |
| 23 | `knee_x_px` | number | px | Filtered dominant knee x. |  |
| 24 | `knee_y_px` | number | px | Filtered dominant knee y. |  |
| 25 | `ankle_x_px` | number | px | Filtered dominant ankle x. |  |
| 26 | `ankle_y_px` | number | px | Filtered dominant ankle y. |  |

## 5. Raw landmark frames (`*_frames_raw.csv`)

One row per processed video frame (irregular timing, i.e. the device's actual detection rate). Columns: `t_ms` (ms from Go, rounded) followed, for each marker key in §6, by:

| Suffix | Meaning | Unit |
|---|---|---|
| `_x`, `_y` | Normalised image position | 0–1 of frame width / height |
| `_z` | Normalised relative depth (MediaPipe image z) | ≈ frame-width units |
| `_v` | MediaPipe visibility (probability the landmark is visible and not occluded) | 0–1 |
| `_wx`, `_wy`, `_wz` | World landmark | m (blank if world data unavailable) |

Example columns: `l_hip_x`, `l_hip_y`, `l_hip_z`, `l_hip_v`, `l_hip_wx`, … Total columns = 1 + 17 × 7 = 120. Values rounded to 4 d.p.

## 6. Tracked pose markers (MediaPipe Pose Landmarker, 33-point model; 17 recorded)

| Key | MediaPipe index | Name | Role in this app |
|---|---|---|---|
| `nose` | 0 | nose | Frame-fit check (head inside frame). |
| `l_sh` | 11 | left_shoulder | Trunk segment top; arm-position reference; obliquity. |
| `r_sh` | 12 | right_shoulder | Trunk segment top; arm-position reference; obliquity. |
| `l_el` | 13 | left_elbow | Recorded for reference (not used in metrics). |
| `r_el` | 14 | right_elbow | Recorded for reference (not used in metrics). |
| `l_wr` | 15 | left_wrist | Arm-use detection (wrist distance from chest). |
| `r_wr` | 16 | right_wrist | Arm-use detection (wrist distance from chest). |
| `l_hip` | 23 | left_hip | Pelvis proxy: vertical displacement, progress p(t), trunk & thigh angles. |
| `r_hip` | 24 | right_hip | Pelvis proxy; camera-obliquity estimate. |
| `l_kn` | 25 | left_knee | Knee angle, shank inclination. |
| `r_kn` | 26 | right_knee | Knee angle, shank inclination. |
| `l_an` | 27 | left_ankle | Knee angle, shank inclination, feet-stay-put check. |
| `r_an` | 28 | right_ankle | Knee angle, shank inclination, feet-stay-put check. |
| `l_heel` | 29 | left_heel | Foot direction (facing check). |
| `r_heel` | 30 | right_heel | Foot direction (facing check). |
| `l_toe` | 31 | left_foot_index | Ankle angle; foot direction. |
| `r_toe` | 32 | right_foot_index | Ankle angle; foot direction. |

The remaining 16 landmarks (eyes, ears, mouth, hands, pinky/index fingers, thumbs) are not recorded. Live overlay shows tracked markers (filled = visibility ≥ 0.5, hollow yellow = below); optional label shows visibility %. Pose model: lite / full / heavy (default full), detect/presence/tracking confidence 0.5/0.5/0.5, 1 pose.

## 7. Definitions of derived quantities

| Term | Definition |
|---|---|
| **Valid marker sample** | A landmark in a frame with visibility ≥ 0.5 and inside the frame. Invalid samples are treated as missing, bridged by linear interpolation, and flagged when the gap exceeds 0.25 s. |
| **Resampling & filtering** | Frames are linearly resampled to 30 Hz, padded with 30 odd-reflected samples at each end, then low-passed with a 2nd-order Butterworth applied forward and backward (zero phase lag, no timing bias). Design cutoff is chosen so the effective −3 dB point is 6 Hz (Winter 2009: human STS content is < 5 Hz). |
| **Scale (m per px)** | Participant height × 0.779 (Winter 2009 trunk 0.288 H + thigh 0.245 H + shank 0.246 H) ÷ pixel length of the shoulder–hip–knee–ankle chain in the standing calibration. The chain is rigid, so the scale is posture-invariant but assumes a side-on camera at the participant's depth. |
| **Hip height / hip up (m)** | Vertical position of the dominant-side hip landmark (pelvis proxy), positive upward, relative to the seated calibration, converted with the scale. |
| **Progress p(t)** | p = (hip height − seated hip height) ÷ (standing hip height − seated hip height); 0 = seated calibration, 1 = calibrated standing. Scale-free, so rep detection does not depend on the m/px scale. |
| **Stand attempt** | State machine on p(t) with hysteresis: attempt begins when p rises through 0.6, ends when it falls back through 0.4. |
| **Events** | Onset / seat-contact: p at 10% of the local excursion; "standing reached" / "descent start": 90%; t50: p = 0.5. Phases: ASCENT (onset → standing reached), STANDING, DESCENT (descent start → seat contact), SEATED. |
| **Counted stand** | t50 inside [0, 30] s AND (peak p ≥ 0.85 AND knee flexion at stand ≤ calibrated standing knee flexion + 20°) OR (peak occurs after 30 s while p already ≥ 0.5 — CDC half-way rule). |
| **Joint angles (2D)** | Knee flexion = 180° − ∠(hip, knee, ankle). Hip flexion = 180° − ∠(shoulder, hip, knee). Trunk inclination = atan2(d·(shoulder.x − hip.x), hip.y − shoulder.y). Shank inclination analogous (ankle→knee). Ankle angle (exploratory) from knee–ankle–toe. d = facing direction. |
| **3D cross-check** | Knee and hip angles recomputed from world landmarks; the mean absolute difference vs 2D is reported and flagged if > 10°. |
| **Arm use** | Wrist distance from the shoulder midpoint in trunk lengths, minus the seated-calibration value; suspected if > 0.35 for ≥ 0.2 s during a rise. Heuristic — not a substitute for observation. |
| **Fatigue / trend** | Least-squares slope of cycle time vs stand number (needs ≥ 4 reps), plus first-vs-last-third comparisons as listed in the summary table. |
| **Work-rate proxy** | Per rep: body mass × 9.81 × hip rise during ascent ÷ ascent time (W); session value is the mean. Hip rise approximates centre-of-mass rise: a proxy, not true mechanical power. |
| **Normative classification** | CDC STEADI below-average cut-points (age 60–94, male/female). Only assigned if `valid_for_norm` (no blocking QC flag). |

## 8. Quality-control flags (`qc_flags`, semicolon-separated)

Blocking flags (set `valid_for_norm = FALSE`, withhold normative classification): `LOW_FPS`, `LOW_VALID_FRAMES`, `TRACKING_GAPS`, `CAMERA_OR_FEET_SHIFT`, `NOT_SEATED_AT_START`, `MOVED_BEFORE_GO`, `ARM_USE_SUSPECTED`, `MANUAL_STOP`, `HIP_RISE_IMPLAUSIBLE`, `FACING_AMBIGUOUS`.

| Flag | Blocking | Trigger |
|---|---|---|
| `LOW_FPS` | yes | Effective detection rate < 15 fps. |
| `LOW_VALID_FRAMES` | yes | < 90% of frames had shoulder, hip, knee and ankle valid. |
| `TRACKING_GAPS` | yes | Imputed samples > 10% or longest gap > 2 × 0.25 s. |
| `CAMERA_OR_FEET_SHIFT` | yes | Ankle moved > 15% of shank length from calibration. |
| `NOT_SEATED_AT_START` | yes | Median pre-roll progress > 0.2 (participant not at seated baseline before Go). |
| `MOVED_BEFORE_GO` | yes | Hip rose before Go. |
| `ARM_USE_SUSPECTED` | yes | See Arm use (§7). |
| `MANUAL_STOP` | yes | Operator stopped before the planned duration. |
| `HIP_RISE_IMPLAUSIBLE` | yes | Calibrated hip rise outside [0.15, 0.65] m. |
| `FACING_AMBIGUOUS` | yes | Knee-based and foot-based facing direction disagree. |
| `OBLIQUE_VIEW` | no | Hip separation / trunk length > 0.2 (camera not side-on). |
| `SCALE_INCONSISTENT` | no | Chain length during test differs > 10% from calibration. |
| `CAMERA_TILT` | no | Standing shank > 5° from vertical in image. |
| `STANDING_CAL_KNEE_FLEXED` | no | Standing-calibration knee flexion > 25°. |
| `KNEE_2D_3D_DISAGREE` | no | 2D vs 3D knee angle mean difference > 10°. |
| `NO_REPS_DETECTED` | no | No stand detected. |

## 9. Algorithm parameters (snapshot is also stored in each `*_session.json`)

Parameters marked **[TUNE]** in `config.js` are engineering defaults **not yet validated** against a criterion measure.

| Parameter | Default |
|---|---|
| `protocol.durationS` | 30 |
| `protocol.countdownS` | 3 |
| `protocol.preRollS` | 1 |
| `protocol.tailS` | 2 |
| `protocol.chairHeightCm` | 43.2 |
| `protocol.halfwayProgress` | 0.5 |
| `calibration.holdS` | 2 |
| `calibration.maxJitterTrunkFrac` | 0.04 |
| `calibration.standMaxKneeFlexDeg` | 25 |
| `calibration.standMaxTrunkInclDeg` | 20 |
| `calibration.seatMinKneeFlexDeg` | 55 |
| `calibration.heightRangeCm` | [120,210] |
| `calibration.hipRiseRangeM` | [0.15,0.65] |
| `signal.resampleHz` | 30 |
| `signal.cutoffHz` | 6 |
| `signal.maxGapS` | 0.25 |
| `signal.minVisibility` | 0.5 |
| `signal.padSamples` | 30 |
| `events.stateHi` | 0.6 |
| `events.stateLo` | 0.4 |
| `events.lowPct` | 0.1 |
| `events.highPct` | 0.9 |
| `events.fullStandProgress` | 0.85 |
| `events.kneeExtToleranceDeg` | 20 |
| `arms.deviationThreshold` | 0.35 |
| `arms.minDurationS` | 0.2 |
| `qc.minEffectiveFps` | 15 |
| `qc.minValidFramePct` | 90 |
| `qc.maxImputedPct` | 10 |
| `qc.maxObliquity` | 0.2 |
| `qc.maxScaleDiffPct` | 10 |
| `qc.maxAnkleShiftShankFrac` | 0.15 |
| `qc.maxShankVerticalDeg` | 5 |
| `qc.maxKnee2D3DDiffDeg` | 10 |
| `qc.blocking` | ["LOW_FPS","LOW_VALID_FRAMES","TRACKING_GAPS","CAMERA_OR_FEET_SHIFT","NOT_SEATED_AT_START","MOVED_BEFORE_GO","ARM_USE_SUSPECTED","MANUAL_STOP","HIP_RISE_IMPLAUSIBLE","FACING_AMBIGUOUS"] |
| `live.emaAlpha` | 0.4 |
| `live.standAt` | 0.85 |
| `live.seatAt` | 0.25 |

## 10. Limitations

- Single 2D camera: joint angles are sagittal-plane projections; error grows with camera obliquity and perspective. Treat as relative measures unless validated against marker-based motion capture.
- Hip landmark is a pelvis proxy; MediaPipe landmarks are not anatomical landmarks and can drift under loose clothing or poor contrast.
- No bilateral symmetry metrics: a side view cannot assess left/right differences.
- Arm-use detection is a heuristic; verify visually when it matters.
- Timing is limited by the device frame rate; frame timestamps include camera capture latency, so absolute alignment to the Go beep may be offset by tens of ms (durations are unaffected).
- Thresholds marked [TUNE] and the full-stand criteria need a concurrent-validity study (e.g. against manual video count and, ideally, optical motion capture) before clinical use.
- STEADI norms are for community-dwelling adults 60–94 and are screening cut-points, not diagnoses.

## 11. References

- Jones CJ, Rikli RE, Beam WC. A 30-s chair-stand test as a measure of lower body strength in community-residing older adults. Res Q Exerc Sport 1999;70(2):113–119.
- Rikli RE, Jones CJ. Functional fitness normative scores for community-residing older adults, ages 60–94. J Aging Phys Act 1999;7:162–181.
- CDC. STEADI — 30-Second Chair Stand Test (2017).
- Winter DA. Biomechanics and Motor Control of Human Movement, 4th ed. Wiley, 2009 (anthropometry, signal filtering).
- Bazarevsky V et al. BlazePose: On-device real-time body pose tracking. arXiv:2006.10204, 2020.
- Needham L et al. The accuracy of several pose estimation methods for 3D joint centre localisation. Sci Rep 2021;11:20673.
