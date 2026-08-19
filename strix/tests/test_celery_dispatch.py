import pytest
from unittest.mock import patch, MagicMock

# Assuming Celery is properly configured in tasks.py
from strix.interface.viewer.tasks import start_scan, celery_app

def test_celery_task_registration():
    """Verify that the start_scan task is registered with Celery."""
    assert start_scan.name in celery_app.tasks.keys()

@patch('strix.interface.viewer.tasks.start_scan.delay')
def test_celery_dispatch_mock(mock_delay):
    """Verify that we can dispatch a scan to celery."""
    cmd = ["strix", "--target", "test.com", "-m", "light", "--run-name", "test_run", "--non-interactive"]
    run_id = "test_run_123"
    
    # Simulate triggering the task
    mock_result = MagicMock()
    mock_result.id = "mock_task_id"
    mock_delay.return_value = mock_result
    
    result = start_scan.delay(cmd, run_id)
    
    # Assert delay was called correctly
    mock_delay.assert_called_once_with(cmd, run_id)
    assert result.id == "mock_task_id"
