/**
 * Sit-to-Stand Biomechanics Lab - Data schema (single source of truth)
 *
 * Every exported field is declared here. The analysis code refuses to emit an
 * undocumented summary field, the CSV/Sheets exporters take their column order from
 * here, and tools/build-dictionary.js renders DATA_DICTIONARY.md from it.
 *
 * Conventions: times in seconds relative to "Go" (t = 0); image y axis points down but
 * all reported vertical quantities are positive upward; angles in degrees; null = not computable.
 */
const SCHEMA = (function () {
    const F = (key, type, unit, desc, calc) => ({ key, type, unit, desc, calc: calc || '' });
    const G = (group, fields) => fields.map(f => Object.assign({ group }, f));

    const summary = [].concat(
        G('Session & participant', [
            F('session_id', 'string', '-', 'Unique session identifier (UUID v4) created in the browser. Links the Sessions, Reps and Frames sheets; used to de-duplicate re-sent uploads.', 'crypto.randomUUID()'),
            F('timestamp_utc', 'datetime', 'ISO 8601 (UTC)', 'Moment the analysis was completed.', 'new Date().toISOString()'),
            F('utc_offset_min', 'integer', 'min', 'Local time-zone offset from UTC at test time (local = UTC + offset).', '-new Date().getTimezoneOffset()'),
            F('app_version', 'string', '-', 'Application version.', 'CONFIG.app.version'),
            F('analysis_version', 'string', '-', 'Version of the analysis algorithms. Changes whenever a metric definition or threshold logic changes.', 'CONFIG.app.analysisVersion'),
            F('schema_version', 'string', '-', 'Version of this data schema.', 'CONFIG.app.schemaVersion'),
            F('participant_id', 'string', '-', 'Pseudonymous participant code entered by the operator. Do not enter real names.', 'Operator input'),
            F('age_years', 'integer', 'years', 'Participant age at test.', 'Operator input'),
            F('sex', 'categorical', 'male | female | other', 'Sex used only for the STEADI normative lookup (the published table is male/female).', 'Operator input'),
            F('height_cm', 'number', 'cm', 'Standing height. Used to convert pixels to metres (see scale_m_per_px).', 'Operator input (measured)'),
            F('body_mass_kg', 'number', 'kg', 'Body mass (optional). Only used for work_rate_proxy_w.', 'Operator input'),
            F('chair_seat_height_cm', 'number', 'cm', 'Seat height of the chair used (STEADI standard 43.2 cm = 17 in). Recorded for covariate use; not used in calculations.', 'Operator input'),
            F('site', 'string', '-', 'Free-text collection site / session label.', 'Operator input'),
            F('operator_notes', 'string', '-', 'Free-text notes. Do not enter identifying information.', 'Operator input')
        ]),
        G('Device & pose model', [
            F('pose_model', 'categorical', 'lite | full | heavy', 'MediaPipe Pose Landmarker variant used.', 'Operator selection'),
            F('pose_delegate', 'categorical', 'GPU | CPU', 'Inference delegate actually used (GPU falls back to CPU if unavailable).', 'MediaPipe initialisation'),
            F('camera_facing', 'categorical', 'environment | user', 'Camera used: rear (environment) or front/webcam (user).', 'Operator selection'),
            F('video_width_px', 'integer', 'px', 'Width of the video stream analysed.', 'HTMLVideoElement.videoWidth'),
            F('video_height_px', 'integer', 'px', 'Height of the video stream analysed.', 'HTMLVideoElement.videoHeight'),
            F('user_agent', 'string', '-', 'Browser user-agent string (truncated to 200 characters).', 'navigator.userAgent')
        ]),
        G('Protocol', [
            F('planned_duration_s', 'number', 's', 'Planned test duration (30 s).', 'CONFIG.protocol.durationS'),
            F('test_duration_s', 'number', 's', 'Duration actually run, capped at the planned duration. Less than planned if the operator stopped early.', 'min(elapsed, planned)'),
            F('manual_stop', 'boolean', '-', 'True if the operator stopped the test before the planned duration.', ''),
            F('arms_crossed_confirmed', 'boolean', '-', 'Operator confirmed the participant was instructed to keep arms crossed on the chest (CDC protocol).', 'Operator checkbox'),
            F('filter_cutoff_hz', 'number', 'Hz', 'Effective -3 dB cutoff of the zero-lag low-pass filter applied to landmark coordinates.', 'CONFIG.signal.cutoffHz'),
            F('resample_hz', 'number', 'Hz', 'Uniform sampling rate of the analysed time series.', 'CONFIG.signal.resampleHz')
        ]),
        G('Primary outcomes', [
            F('stands_count', 'integer', 'stands', 'Number of full stands in the test window (CDC 30-s chair stand score). Offline, zero-lag analysis. A rise counts when its 50 %-progress crossing is within the window AND it reached full stand (peak progress >= fullStandProgress and knee extension criterion) OR is still rising at the end (half-way rule).', 'Offline event detection (see Definitions)'),
            F('live_count', 'integer', 'stands', 'Count shown live during the test (causal, simple thresholds). Recorded to audit the offline count.', 'Live state machine'),
            F('count_difference', 'integer', 'stands', 'stands_count minus live_count. Non-zero indicates the live display was wrong.', 'stands_count - live_count'),
            F('half_rule_applied', 'boolean', '-', 'True if at least one stand was counted under the CDC half-way rule (more than halfway up when time expired).', ''),
            F('incomplete_attempts', 'integer', 'attempts', 'Rises that passed the attempt threshold (progress >= stateHi) inside the window but were not counted (did not reach full stand).', ''),
            F('stands_first_half', 'integer', 'stands', 'Counted stands whose 50 %-progress crossing occurred in the first half of the test (t <= 15 s).', ''),
            F('stands_second_half', 'integer', 'stands', 'Counted stands whose 50 %-progress crossing occurred in the second half (t > 15 s).', ''),
            F('norm_reference', 'string', '-', 'Normative table used for classification.', 'CONFIG.steadi.reference'),
            F('norm_cutoff_below_average', 'integer', 'stands', 'STEADI cut-point for the participant\'s age/sex: fewer stands than this = below average. Null if age outside 60-94 or sex not male/female.', 'Table lookup'),
            F('norm_classification', 'categorical', '-', '"Below average", "Average or above", or "Not classified" (age/sex outside table, or the session failed protocol/QC checks - see valid_for_norm).', 'stands_count vs cut-point, only if valid_for_norm')
        ]),
        G('Temporal metrics', [
            F('time_to_first_stand_s', 'number', 's', 'Time from "Go" until the first counted rep reaches standing (includes reaction time).', 't_standing_s of first counted rep'),
            F('cycle_time_mean_s', 'number', 's', 'Mean interval between consecutive movement onsets (counted reps).', 'mean(cycle_time_s)'),
            F('cycle_time_sd_s', 'number', 's', 'Sample standard deviation (n-1) of cycle time.', ''),
            F('cycle_time_cv_pct', 'number', '%', 'Coefficient of variation of cycle time = SD / mean x 100. Pacing consistency.', ''),
            F('cycle_time_min_s', 'number', 's', 'Shortest cycle time.', ''),
            F('cycle_time_max_s', 'number', 's', 'Longest cycle time.', ''),
            F('cycle_time_slope_s_per_rep', 'number', 's/rep', 'Least-squares slope of cycle time against rep number (fatigue/slowing trend). Null if fewer than 4 cycles.', 'OLS'),
            F('cycle_time_change_pct', 'number', '%', 'Change in mean cycle time from first third to last third of reps (positive = slowing). Null if fewer than 6 counted reps.', '(mean last third - mean first third) / mean first third x 100'),
            F('ascent_time_mean_s', 'number', 's', 'Mean ascent duration (10 % to 90 % of hip excursion).', ''),
            F('ascent_time_sd_s', 'number', 's', 'Sample SD of ascent duration.', ''),
            F('standing_dwell_mean_s', 'number', 's', 'Mean time spent at the top (90 % up to 90 % down).', ''),
            F('descent_time_mean_s', 'number', 's', 'Mean descent duration (90 % to 10 % of hip excursion).', ''),
            F('descent_time_sd_s', 'number', 's', 'Sample SD of descent duration.', ''),
            F('seated_dwell_mean_s', 'number', 's', 'Mean time between seat contact and next movement onset.', '')
        ]),
        G('Hip (pelvis-proxy) kinematics', [
            F('hip_rise_mean_m', 'number', 'm', 'Mean vertical rise of the hip marker from onset to standing. Requires correct height entry for metric accuracy.', 'Δy x scale_m_per_px'),
            F('peak_ascent_velocity_mean_m_s', 'number', 'm/s', 'Mean of per-rep peak upward hip velocity.', 'Central-difference derivative of filtered hip height'),
            F('peak_ascent_velocity_sd_m_s', 'number', 'm/s', 'Sample SD of per-rep peak ascent velocity.', ''),
            F('peak_ascent_velocity_max_m_s', 'number', 'm/s', 'Highest peak ascent velocity of any counted rep.', ''),
            F('ascent_mean_velocity_mean_m_s', 'number', 'm/s', 'Mean of per-rep average ascent velocity (hip rise 10 %-90 % divided by ascent time).', ''),
            F('peak_descent_velocity_mean_m_s', 'number', 'm/s', 'Mean of per-rep peak downward hip speed (positive number).', ''),
            F('ascent_velocity_change_pct', 'number', '%', 'Change in mean peak ascent velocity from first third to last third of reps (negative = slowing). Null if fewer than 6 counted reps.', ''),
            F('work_rate_proxy_mean_w', 'number', 'W', 'Mean of body mass x g x hip rise / ascent time. A crude vertical work-rate PROXY for the whole-body centre of mass; not validated mechanical power. Null if body mass not entered.', 'm x 9.81 x Δh / t_ascent')
        ]),
        G('Joint & segment kinematics (sagittal plane, side view)', [
            F('knee_flex_seated_mean_deg', 'number', 'deg', 'Mean knee flexion at movement onset (0 = straight leg).', ''),
            F('knee_flex_standing_mean_deg', 'number', 'deg', 'Mean knee flexion while standing at the top.', ''),
            F('knee_rom_mean_deg', 'number', 'deg', 'Mean knee range of motion used in the ascent (onset minus standing).', ''),
            F('knee_ext_peak_velocity_mean_deg_s', 'number', 'deg/s', 'Mean of per-rep peak knee extension angular velocity.', ''),
            F('hip_flex_seated_mean_deg', 'number', 'deg', 'Mean hip flexion (trunk-thigh angle complement) at onset (0 = trunk and thigh collinear).', ''),
            F('hip_flex_standing_mean_deg', 'number', 'deg', 'Mean hip flexion while standing.', ''),
            F('hip_ext_peak_velocity_mean_deg_s', 'number', 'deg/s', 'Mean of per-rep peak hip extension angular velocity.', ''),
            F('trunk_lean_peak_mean_deg', 'number', 'deg', 'Mean of per-rep peak forward trunk inclination from vertical during the ascent (momentum/leaning strategy).', ''),
            F('trunk_lean_peak_max_deg', 'number', 'deg', 'Largest peak trunk inclination of any counted rep.', ''),
            F('trunk_incl_standing_mean_deg', 'number', 'deg', 'Mean trunk inclination from vertical while standing (0 = upright; positive = forward).', ''),
            F('shank_incl_peak_mean_deg', 'number', 'deg', 'Mean of per-rep peak shank inclination (knee forward of ankle) during the ascent.', ''),
            F('ankle_angle_range_mean_deg', 'number', 'deg', 'EXPLORATORY. Mean range of the knee-ankle-toe angle during ascent. Foot landmarks are the least reliable markers.', '')
        ]),
        G('Calibration', [
            F('dominant_side', 'categorical', 'left | right', 'Body side nearest the camera, whose markers drive all kinematics (chosen by mean visibility during calibration).', ''),
            F('facing_direction', 'categorical', 'left | right', 'Direction the participant faces in the image (from knee position relative to hip while seated). Defines the sign of trunk/shank inclination.', ''),
            F('scale_m_per_px', 'number', 'm/px', 'Metres per image pixel at the participant\'s plane: 0.779 x height / pixel length of the shoulder-hip-knee-ankle chain in the standing calibration.', 'Winter (2009) chain fraction'),
            F('scale_check_diff_pct', 'number', '%', 'Percent difference between the median chain length during the test and during standing calibration. Large values = foreshortening or camera/participant movement.', ''),
            F('calib_chain_px', 'number', 'px', 'Pixel length of the shoulder-hip-knee-ankle chain in the standing calibration.', ''),
            F('calib_hip_rise_m', 'number', 'm', 'Hip rise between seated and standing calibration (scaled). Plausibility check on height entry and calibration.', ''),
            F('calib_standing_knee_flex_deg', 'number', 'deg', 'Knee flexion in the standing calibration.', ''),
            F('calib_seated_knee_flex_deg', 'number', 'deg', 'Knee flexion in the seated calibration.', ''),
            F('calib_standing_trunk_incl_deg', 'number', 'deg', 'Trunk inclination in the standing calibration.', ''),
            F('calib_shank_from_vertical_deg', 'number', 'deg', 'Absolute shank inclination in the standing calibration. Large values suggest camera tilt.', ''),
            F('calib_seated_arm_dev', 'number', 'trunk lengths', 'Wrist-to-shoulder-midpoint distance in the seated calibration (arms crossed baseline).', '')
        ]),
        G('Quality control', [
            F('effective_fs_hz', 'number', 'Hz', 'Frames analysed by the pose model per second in the test window (detector throughput).', 'attempted frames / window duration'),
            F('valid_frame_pct', 'number', '%', 'Percentage of analysed frames in which shoulder, hip, knee and ankle were all confidently detected.', ''),
            F('imputed_sample_pct', 'number', '%', 'Percentage of resampled time-series samples that lie in a tracking gap longer than maxGapS (bridged by interpolation).', ''),
            F('longest_gap_s', 'number', 's', 'Longest interval without a confident detection of the full dominant chain in the test window.', ''),
            F('median_chain_visibility', 'number', '0-1', 'Median of the mean MediaPipe visibility score of the four chain landmarks.', ''),
            F('view_obliquity_median', 'number', 'trunk lengths', 'Median |left hip x - right hip x| / trunk length. ~0 when the camera is perpendicular to the sagittal plane; larger = oblique view.', ''),
            F('knee_2d_3d_diff_deg', 'number', 'deg', 'Mean absolute difference between 2D image knee flexion and 3D (world-landmark) knee flexion. Cross-check of view alignment.', ''),
            F('ankle_shift_shank_frac', 'number', 'shank lengths', 'Shift of the median ankle y during the test from the standing calibration, in shank lengths. Detects camera movement or feet sliding.', ''),
            F('arm_use_reps', 'integer', 'reps', 'Counted reps in which arm use (wrists leaving the chest) was suspected.', ''),
            F('qc_flags', 'string', '; separated', 'Codes of all QC conditions triggered (see Definitions).', ''),
            F('qc_pass', 'boolean', '-', 'True if no BLOCKING QC flag was raised.', ''),
            F('valid_for_norm', 'boolean', '-', 'True if the session may be compared with CDC norms: qc_pass, full duration, arms-crossed confirmed, age 60-94, sex male/female.', '')
        ])
    );

    const reps = [].concat(
        G('Identity', [
            F('session_id', 'string', '-', 'Links to the Sessions sheet.'),
            F('rep_index', 'integer', '-', 'Order of the detected rise within the test window (all attempts, 1-based).'),
            F('stand_number', 'integer', '-', 'Running number of COUNTED stands (null if not counted).'),
            F('counted', 'boolean', '-', 'Whether this rise contributes to stands_count.'),
            F('counted_by_half_rule', 'boolean', '-', 'Counted only because it was more than halfway up when time expired.'),
            F('full_stand_hip', 'boolean', '-', 'Peak hip progress >= fullStandProgress.'),
            F('full_stand_knee', 'boolean', '-', 'Knee flexion at standing <= calibrated standing knee flexion + tolerance.')
        ]),
        G('Event times (s from Go)', [
            F('t_onset_s', 'number', 's', 'Movement onset: hip progress leaves the seated level (10 % of the rep\'s hip excursion).'),
            F('t_half_s', 'number', 's', 'Time progress crosses 50 % (used for the counting window and CDC half-way rule).'),
            F('t_standing_s', 'number', 's', 'Standing reached: 90 % of the rep\'s hip excursion.'),
            F('t_descent_start_s', 'number', 's', 'Descent begins: hip falls below 90 % of the excursion.'),
            F('t_seat_contact_s', 'number', 's', 'Seat contact: hip returns to within 10 % of the seated level.')
        ]),
        G('Phase durations (s)', [
            F('ascent_time_s', 'number', 's', 'Onset to standing (10-90 %).'),
            F('standing_dwell_s', 'number', 's', 'Standing to descent start.'),
            F('descent_time_s', 'number', 's', 'Descent start to seat contact.'),
            F('seated_dwell_s', 'number', 's', 'Seat contact to the next rep\'s onset.'),
            F('cycle_time_s', 'number', 's', 'Onset to next rep\'s onset (null for the last rep).')
        ]),
        G('Hip kinematics', [
            F('peak_progress', 'number', '0-1', 'Highest hip progress reached (1 = calibrated standing height).'),
            F('hip_rise_m', 'number', 'm', 'Hip vertical rise from onset to standing.'),
            F('peak_ascent_velocity_m_s', 'number', 'm/s', 'Maximum upward hip velocity during the rise.'),
            F('time_to_peak_velocity_s', 'number', 's', 'Time from onset to peak ascent velocity.'),
            F('ascent_mean_velocity_m_s', 'number', 'm/s', 'Hip rise divided by ascent time.'),
            F('peak_descent_velocity_m_s', 'number', 'm/s', 'Maximum downward hip speed (positive).'),
            F('work_rate_proxy_w', 'number', 'W', 'm x 9.81 x hip rise / ascent time (null if no body mass). Proxy only.')
        ]),
        G('Joint & segment kinematics', [
            F('knee_flex_onset_deg', 'number', 'deg', 'Knee flexion at onset.'),
            F('knee_flex_standing_deg', 'number', 'deg', 'Median knee flexion while standing.'),
            F('knee_rom_deg', 'number', 'deg', 'Onset minus standing knee flexion.'),
            F('knee_ext_peak_velocity_deg_s', 'number', 'deg/s', 'Peak knee extension angular velocity in the ascent.'),
            F('hip_flex_onset_deg', 'number', 'deg', 'Hip flexion at onset.'),
            F('hip_flex_standing_deg', 'number', 'deg', 'Median hip flexion while standing.'),
            F('hip_ext_peak_velocity_deg_s', 'number', 'deg/s', 'Peak hip extension angular velocity in the ascent.'),
            F('trunk_incl_onset_deg', 'number', 'deg', 'Trunk inclination from vertical at onset (positive = forward).'),
            F('trunk_lean_peak_deg', 'number', 'deg', 'Peak forward trunk inclination during the ascent.'),
            F('trunk_incl_standing_deg', 'number', 'deg', 'Median trunk inclination while standing.'),
            F('shank_incl_peak_deg', 'number', 'deg', 'Peak shank inclination (knee anterior to ankle) in the ascent.'),
            F('ankle_angle_range_deg', 'number', 'deg', 'EXPLORATORY. Range of knee-ankle-toe angle in the ascent.')
        ]),
        G('Protocol & tracking flags', [
            F('arm_dev_max', 'number', 'trunk lengths', 'Largest increase of wrist-to-chest distance above the seated baseline during the ascent window.'),
            F('arm_use_flag', 'categorical', 'no | suspected | unavailable', 'Arm-use screening result; "unavailable" when wrists were not visible.'),
            F('tracking_gap_flag', 'boolean', '-', 'A tracking gap longer than maxGapS overlaps this rep.')
        ])
    );

    const frames = [].concat(
        G('Time series (uniform grid, filtered)', [
            F('session_id', 'string', '-', 'Links to the Sessions sheet.'),
            F('t_s', 'number', 's', 'Time relative to "Go" (negative = pre-roll).'),
            F('phase', 'categorical', 'SEATED | ASCENT | STANDING | DESCENT', 'Movement phase from the event detection (only reps in the table are labelled).'),
            F('tracking_gap', 'integer', '0/1', '1 if the sample lies in a tracking gap longer than maxGapS.'),
            F('progress', 'number', '0-1+', 'Hip progress p(t): 0 = seated baseline, 1 = calibrated standing hip height.'),
            F('hip_up_m', 'number', 'm', 'Hip height above the seated baseline.'),
            F('hip_vel_m_s', 'number', 'm/s', 'Vertical hip velocity (positive = rising).'),
            F('knee_flex_deg', 'number', 'deg', 'Knee flexion, 2D sagittal.'),
            F('knee_vel_deg_s', 'number', 'deg/s', 'Knee flexion angular velocity (negative = extending).'),
            F('hip_flex_deg', 'number', 'deg', 'Hip flexion (trunk-thigh), 2D sagittal.'),
            F('hip_flex_vel_deg_s', 'number', 'deg/s', 'Hip flexion angular velocity.'),
            F('trunk_incl_deg', 'number', 'deg', 'Trunk inclination from vertical (positive = forward).'),
            F('shank_incl_deg', 'number', 'deg', 'Shank inclination from vertical (positive = knee forward of ankle).'),
            F('ankle_angle_deg', 'number', 'deg', 'Knee-ankle-toe included angle (exploratory).'),
            F('knee_flex_3d_deg', 'number', 'deg', 'Knee flexion from MediaPipe world landmarks (cross-check).'),
            F('hip_flex_3d_deg', 'number', 'deg', 'Hip flexion from MediaPipe world landmarks (cross-check).'),
            F('arm_dev', 'number', 'trunk lengths', 'Mean wrist distance from shoulder midpoint / seated trunk length.'),
            F('obliquity', 'number', 'trunk lengths', '|left hip x - right hip x| / trunk length.'),
            F('sh_x_px', 'number', 'px', 'Filtered dominant shoulder x.'),
            F('sh_y_px', 'number', 'px', 'Filtered dominant shoulder y (image coordinates, down = larger).'),
            F('hip_x_px', 'number', 'px', 'Filtered dominant hip x.'),
            F('hip_y_px', 'number', 'px', 'Filtered dominant hip y.'),
            F('knee_x_px', 'number', 'px', 'Filtered dominant knee x.'),
            F('knee_y_px', 'number', 'px', 'Filtered dominant knee y.'),
            F('ankle_x_px', 'number', 'px', 'Filtered dominant ankle x.'),
            F('ankle_y_px', 'number', 'px', 'Filtered dominant ankle y.')
        ])
    );

    return { summary, reps, frames };
})();

if (typeof module !== 'undefined') module.exports = SCHEMA;
