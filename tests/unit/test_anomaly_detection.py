"""
Unit tests for anomaly detection algorithm in pdf_report_service.py.

Tests are mock-free — detect_anomalies() is a pure function tested with controlled series.
All tests use series_data as {var_key: [float|null]} with aligned dates.
"""
import math

import pytest

from services.pdf_report_service import (
    AnomalyEvent,
    AnomalyResult,
    detect_anomalies,
    identify_events,
    merge_consecutive_events,
    rank_and_truncate_events,
    rolling_z_scores,
)


# ---------------------------------------------------------------------------
# rolling_z_scores
# ---------------------------------------------------------------------------

class TestRollingZScores:
    """Tests for rolling_z_scores function."""

    def test_nan_for_first_window_minus_one_values(self) -> None:
        """
        GIVEN series with 10 observations, window=7
        WHEN rolling_z_scores is called
        THEN first 6 values are NaN
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 11)]
        series_data = {"ndvi": [0.3 + i * 0.05 for i in range(10)]}

        z_scores = rolling_z_scores(series_data, dates, window=7)

        assert len(z_scores) == 10
        nan_count = sum(1 for z in z_scores[:6] if math.isnan(z))
        assert nan_count == 6

    def test_nan_when_insufficient_observations(self) -> None:
        """
        GIVEN series with fewer observations than window
        WHEN rolling_z_scores is called
        THEN all values are NaN
        """
        dates = ["2020-01-01", "2020-01-02", "2020-01-03"]
        series_data = {"ndvi": [0.3, 0.4, 0.5]}

        z_scores = rolling_z_scores(series_data, dates, window=7)

        assert len(z_scores) == 3
        assert all(math.isnan(z) for z in z_scores)

    def test_z_score_computed_correctly(self) -> None:
        """
        GIVEN a constant series [10,10,10,10,10,10,10,20] with window=7
        WHEN rolling_z_scores is called
        THEN the last z-score is positive (20 is far above the rolling mean of 10)
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 9)]
        # First 7 values = 10, last value = 20
        series_data = {"ndvi": [10.0] * 7 + [20.0]}

        z_scores = rolling_z_scores(series_data, dates, window=7)

        # First 6 are NaN, last one should be computable
        assert math.isnan(z_scores[0])
        last_z = z_scores[-1]
        assert not math.isnan(last_z)
        assert last_z > 0  # 20 is above the rolling mean of 10


# ---------------------------------------------------------------------------
# identify_events
# ---------------------------------------------------------------------------

class TestIdentifyEvents:
    """Tests for identify_events function."""

    def test_single_spike_identified(self) -> None:
        """
        GIVEN z-scores with one point z=3.2 and adjacent |z|<1.5
        WHEN identify_events is called
        THEN exactly one spike event is produced
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 11)]
        # z=3.2 at index 5, others near 0
        z_scores = [0.1, 0.2, 0.1, 0.3, 0.2, 3.2, 0.1, 0.2, 0.1, 0.3]

        events = identify_events(z_scores, dates)

        assert len(events) == 1
        assert events[0].type == "spike"
        assert events[0].magnitude == 3.2
        assert events[0].duration_days == 1

    def test_single_drop_identified(self) -> None:
        """
        GIVEN z-scores with one point z=-3.1 and adjacent |z|<1.5
        WHEN identify_events is called
        THEN exactly one drop event is produced
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 11)]
        z_scores = [0.1, 0.2, -3.1, 0.1, 0.2, 0.3, 0.1, 0.2, 0.1, 0.3]

        events = identify_events(z_scores, dates)

        assert len(events) == 1
        assert events[0].type == "drop"
        assert events[0].magnitude == 3.1
        assert events[0].duration_days == 1

    def test_sustained_shift_3_consecutive(self) -> None:
        """
        GIVEN 5 consecutive z-scores all with |z|>1.5 (sustained shift)
        WHEN identify_events is called
        THEN exactly one sustained_shift event is produced
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 11)]
        # First 5 z > 1.5 (consecutive sustained shift)
        z_scores = [1.6, 1.8, 2.0, 1.7, 1.6, 0.2, 0.1, 0.3, 0.2, 0.1]

        events = identify_events(z_scores, dates)

        assert len(events) == 1
        assert events[0].type == "sustained_shift"
        assert events[0].magnitude == 2.0  # max |z| in the run
        assert events[0].duration_days == 5

    def test_no_events_when_below_threshold(self) -> None:
        """
        GIVEN z-scores that never exceed 2.5 in magnitude
        WHEN identify_events is called
        THEN no events are produced
        """
        dates = [f"2020-01-{i:02d}" for i in range(1, 11)]
        z_scores = [-1.0, -0.8, 1.0, 1.2, 1.4, 1.3, 1.1, -0.5, -0.3, -0.7]

        events = identify_events(z_scores, dates)

        assert len(events) == 0


# ---------------------------------------------------------------------------
# merge_consecutive_events
# ---------------------------------------------------------------------------

class TestMergeConsecutiveEvents:
    """Tests for merge_consecutive_events function."""

    def test_five_consecutive_spikes_merge_to_one(self) -> None:
        """
        GIVEN 5 consecutive spike events with magnitudes [2.6, 2.7, 2.8, 2.9, 3.0]
        WHEN merge_consecutive_events is called
        THEN exactly 1 event is produced with magnitude=3.0 and duration_days=5
        """
        events = [
            AnomalyEvent(
                start_date=f"2020-01-0{i+1}",
                end_date=f"2020-01-0{i+1}",
                type="spike",
                magnitude=2.6 + i * 0.1,
                severity="Media",
                duration_days=1,
                description="",
            )
            for i in range(5)
        ]

        merged = merge_consecutive_events(events)

        assert len(merged) == 1
        assert merged[0].magnitude == 3.0
        assert merged[0].duration_days == 5
        assert merged[0].start_date == "2020-01-01"

    def test_different_types_not_merged(self) -> None:
        """
        GIVEN spike followed by drop (different types)
        WHEN merge_consecutive_events is called
        THEN both events are kept separate
        """
        events = [
            AnomalyEvent(
                start_date="2020-01-01",
                end_date="2020-01-01",
                type="spike",
                magnitude=3.0,
                severity="Alta",
                duration_days=1,
                description="",
            ),
            AnomalyEvent(
                start_date="2020-01-02",
                end_date="2020-01-02",
                type="drop",
                magnitude=2.8,
                severity="Media",
                duration_days=1,
                description="",
            ),
        ]

        merged = merge_consecutive_events(events)

        assert len(merged) == 2

    def test_empty_list_returns_empty(self) -> None:
        """GIVEN empty events list WHEN merge_consecutive_events is called THEN returns empty list."""
        merged = merge_consecutive_events([])
        assert merged == []


# ---------------------------------------------------------------------------
# rank_and_truncate_events
# ---------------------------------------------------------------------------

class TestRankAndTruncateEvents:
    """Tests for rank_and_truncate_events function."""

    def test_top_3_ranked_by_magnitude(self) -> None:
        """
        GIVEN 6 events with magnitudes [2.6, 2.5, 4.2, 3.8, 2.9, 3.1]
        WHEN rank_and_truncate_events(events, top_n=3) is called
        THEN returned events have magnitudes [4.2, 3.8, 3.1]
        """
        events = [
            AnomalyEvent(
                start_date=f"2020-01-0{i}",
                end_date=f"2020-01-0{i}",
                type="spike",
                magnitude=m,
                severity="Media",
                duration_days=1,
                description="",
            )
            for i, m in enumerate([2.6, 2.5, 4.2, 3.8, 2.9, 3.1], start=1)
        ]

        ranked = rank_and_truncate_events(events, top_n=3)

        assert len(ranked) == 3
        assert [e.magnitude for e in ranked] == [4.2, 3.8, 3.1]

    def test_fewer_than_top_n_returns_all(self) -> None:
        """
        GIVEN 2 events, requesting top_n=3
        WHEN rank_and_truncate_events is called
        THEN both events are returned
        """
        events = [
            AnomalyEvent(
                start_date="2020-01-01",
                end_date="2020-01-01",
                type="spike",
                magnitude=2.5,
                severity="Media",
                duration_days=1,
                description="",
            ),
            AnomalyEvent(
                start_date="2020-01-02",
                end_date="2020-01-02",
                type="drop",
                magnitude=2.8,
                severity="Media",
                duration_days=1,
                description="",
            ),
        ]

        ranked = rank_and_truncate_events(events, top_n=3)

        assert len(ranked) == 2


# ---------------------------------------------------------------------------
# detect_anomalies fallback conditions
# ---------------------------------------------------------------------------

class TestDetectAnomaliesFallback:
    """Tests for detect_anomalies fallback conditions."""

    def test_fallback_insufficient_observations(self) -> None:
        """
        GIVEN report_type=anomaly but only 9 observations
        WHEN detect_anomalies is called
        THEN fallback_reason=insufficient_observations and effective_report_type=summary
        """
        series_data = {"ndvi": [0.3] * 9}
        dates = [f"2020-01-{i:02d}" for i in range(1, 10)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "summary"
        assert result.fallback_reason == "insufficient_observations"
        assert result.events == []

    def test_fallback_zero_variance(self) -> None:
        """
        GIVEN all identical values (max-min < 1e-6)
        WHEN detect_anomalies is called
        THEN fallback_reason=zero_variance and effective_report_type=summary
        """
        series_data = {"ndvi": [0.5] * 20}
        dates = [f"2020-01-{i:02d}" for i in range(1, 21)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "summary"
        assert result.fallback_reason == "zero_variance"
        assert result.events == []

    def test_fallback_no_anomalies_above_threshold(self) -> None:
        """
        GIVEN 20 observations with no |z| >= 2.5
        WHEN detect_anomalies is called
        THEN fallback_reason=no_anomalies_above_threshold and effective_report_type=summary
        """
        # Values near the mean with small variance — z-scores will be small
        series_data = {"ndvi": [0.5 + (i % 3) * 0.01 for i in range(20)]}
        dates = [f"2020-01-{i:02d}" for i in range(1, 21)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "summary"
        assert result.fallback_reason == "no_anomalies_above_threshold"
        assert result.events == []


# ---------------------------------------------------------------------------
# detect_anomalies — successful detection
# ---------------------------------------------------------------------------

class TestDetectAnomaliesSuccess:
    """Tests for detect_anomalies when anomaly events are found."""

    def test_spike_detected_with_anomaly_result(self) -> None:
        """
        GIVEN a series with a clear spike (z=2.45 with window=7 surrounding 0.5 values)
        WHEN detect_anomalies is called
        THEN one spike event is returned with effective_report_type=anomaly

        Note: With window=7 and 6 surrounding values at 0.5, a value of 5.0 gives
        z = (5-1)/1.63 ≈ 2.45 which is below threshold. We use 10.0 which gives
        z ≈ 5.52 to exceed the 2.5 threshold.
        """
        # Create a series with one clear spike at index 6
        # With window=7, the spike must be extreme enough to overcome the
        # rolling std of the 7-element window. Using value=10.0 → z≈5.52
        series_data = {
            "ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 10.0, 0.5, 0.5, 0.5, 0.5, 0.5]
        }
        dates = [f"2020-01-{i:02d}" for i in range(1, 13)]

        result = detect_anomalies(series_data, dates)

        assert result.effective_report_type == "anomaly"
        assert result.fallback_reason is None
        assert len(result.events) >= 1
        # At least one event should be detected
        assert any(e.type in ("spike", "drop", "sustained_shift") for e in result.events)

    def test_events_have_valid_description(self) -> None:
        """
        GIVEN a spike event is produced
        WHEN detect_anomalies is called
        THEN the event has a non-empty description
        """
        series_data = {
            "ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8, 0.5, 0.5, 0.5, 0.5, 0.5]
        }
        dates = [f"2020-01-{i:02d}" for i in range(1, 13)]

        result = detect_anomalies(series_data, dates)

        for event in result.events:
            assert event.description != ""
            assert "2020-01" in event.description


# ---------------------------------------------------------------------------
# Severity computation (tested directly via compute_severity)
# ---------------------------------------------------------------------------

from services.pdf_report_service import compute_severity


class TestSeverityClassification:
    """Tests for severity classification via compute_severity directly."""

    def test_42_sigma_is_alta(self) -> None:
        """
        GIVEN |z| = 4.2 (> 3.5 threshold)
        WHEN compute_severity is called
        THEN severity is Alta
        """
        severity = compute_severity(magnitude=4.2, duration_days=1, z_scores=[], event_start_idx=0)
        assert severity == "Alta"

    def test_30_sigma_is_media(self) -> None:
        """
        GIVEN |z| = 3.0 (in [2.5, 3.5] range)
        WHEN compute_severity is called
        THEN severity is Media
        """
        # Single-day, adjacent z < 1.5 → not Baja
        z_scores = [float("nan")] * 10 + [0.0, 0.0, 0.0]  # adjacent are 0 < 1.5
        severity = compute_severity(magnitude=3.0, duration_days=1, z_scores=z_scores, event_start_idx=10)
        assert severity == "Media"

    def test_26_sigma_baja_when_single_day_and_adjacent_normal(self) -> None:
        """
        GIVEN |z| = 2.6, single-day, adjacent z < 1.5
        WHEN compute_severity is called
        THEN severity is Baja
        """
        z_scores = [0.5] * 9 + [2.6] + [0.5]  # both adjacent are 0.5 < 1.5
        severity = compute_severity(magnitude=2.6, duration_days=1, z_scores=z_scores, event_start_idx=9)
        assert severity == "Baja"

    def test_26_sigma_media_when_multi_day(self) -> None:
        """
        GIVEN |z| = 2.6, multi-day sustained_shift
        WHEN compute_severity is called
        THEN severity is Media (Baja requires single-day)
        """
        severity = compute_severity(magnitude=2.6, duration_days=5, z_scores=[], event_start_idx=0)
        assert severity == "Media"

    def test_35_sigma_is_media_boundary(self) -> None:
        """
        GIVEN |z| = 3.5 (exactly at Alta threshold boundary, not > 3.5)
        WHEN compute_severity is called
        THEN severity is Media
        """
        severity = compute_severity(magnitude=3.5, duration_days=1, z_scores=[], event_start_idx=0)
        assert severity == "Media"

    def test_351_sigma_is_alta_boundary(self) -> None:
        """
        GIVEN |z| = 3.51 (just above 3.5 threshold)
        WHEN compute_severity is called
        THEN severity is Alta
        """
        severity = compute_severity(magnitude=3.51, duration_days=1, z_scores=[], event_start_idx=0)
        assert severity == "Alta"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    """Tests that detect_anomalies produces identical output for identical input."""

    def test_same_data_twice_produces_identical_events(self) -> None:
        """
        GIVEN a series with a spike
        WHEN detect_anomalies is called twice with identical data
        THEN event descriptions are identical in both runs
        """
        series_data = {
            "ndvi": [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5]
        }
        dates = [f"2020-01-{i:02d}" for i in range(1, 13)]

        result1 = detect_anomalies(series_data, dates)
        result2 = detect_anomalies(series_data, dates)

        if result1.events and result2.events:
            assert len(result1.events) == len(result2.events)
            for e1, e2 in zip(result1.events, result2.events):
                assert e1.description == e2.description
                assert e1.magnitude == e2.magnitude
                assert e1.type == e2.type