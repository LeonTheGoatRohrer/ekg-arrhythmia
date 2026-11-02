"""Unit tests for ekg.models.cnn1d (synthetic tensors only)."""

import json

import pytest
import torch

from ekg.models.cnn1d import ECGNet1D, count_parameters, describe_architecture


@pytest.fixture
def model():
    torch.manual_seed(0)
    return ECGNet1D()


def test_output_shape_2d_and_3d_input(model):
    model.eval()
    x = torch.randn(8, 252)
    rr = torch.rand(8, 4)
    out2 = model(x, rr)
    out3 = model(x.unsqueeze(1), rr)
    assert out2.shape == (8, 5)
    assert torch.allclose(out2, out3)


def test_rr_none_equals_zeros(model):
    model.eval()
    x = torch.randn(4, 252)
    assert torch.allclose(model(x), model(x, torch.zeros(4, 4)))


def test_rr_influences_output(model):
    model.eval()
    x = torch.randn(4, 252)
    assert not torch.allclose(model(x, torch.zeros(4, 4)), model(x, torch.ones(4, 4)))


def test_custom_classes_and_length():
    m = ECGNet1D(n_classes=3, in_len=200).eval()
    assert m(torch.randn(2, 200)).shape == (2, 3)


def test_invalid_shapes(model):
    with pytest.raises(ValueError):
        model(torch.randn(2, 2, 252))
    with pytest.raises(ValueError):
        model(torch.randn(2, 252), torch.randn(2, 3))


def test_batch_size_one_train_and_eval(model):
    model.train()
    assert model(torch.randn(1, 252), torch.rand(1, 4)).shape == (1, 5)
    model.eval()
    assert model(torch.randn(1, 252), torch.rand(1, 4)).shape == (1, 5)


def test_gradient_flow(model):
    model.train()
    x = torch.randn(16, 252)
    rr = torch.rand(16, 4)
    y = torch.randint(0, 5, (16,))
    loss = torch.nn.functional.cross_entropy(model(x, rr), y)
    loss.backward()
    for name, p in model.named_parameters():
        assert p.grad is not None, name
        assert torch.isfinite(p.grad).all(), name
    # Every block (conv branch, rr branch, head) actually receives signal.
    assert model.features.conv1.weight.grad.abs().sum() > 0
    assert model.rr_branch.fc.weight.grad.abs().sum() > 0
    assert model.head.fc2.weight.grad.abs().sum() > 0


def test_eval_determinism(model):
    model.eval()
    x = torch.randn(5, 252)
    rr = torch.rand(5, 4)
    with torch.no_grad():
        assert torch.equal(model(x, rr), model(x, rr))


def test_count_parameters(model):
    expected = sum(p.numel() for p in model.parameters())
    assert count_parameters(model) == expected
    assert expected > 0


def test_describe_architecture(model):
    model.train()
    layers = describe_architecture(model)
    assert model.training, "training mode must be restored"
    for layer in layers:
        assert set(layer) == {"name", "type", "output_shape", "params", "detail"}
    names = [layer["name"] for layer in layers]
    assert names[0] == "input"
    assert "rr_input" in names
    assert sum(layer["params"] for layer in layers) == count_parameters(model)

    by_name = {layer["name"]: layer for layer in layers}
    assert by_name["input"]["output_shape"] == [1, 1, 252]
    assert by_name["features.conv1"]["output_shape"] == [1, 16, 252]
    assert by_name["features.conv1"]["detail"].startswith("kernel=7, 1->16")
    assert by_name["features.pool1"]["output_shape"] == [1, 16, 126]
    assert by_name["features.pool2"]["output_shape"] == [1, 32, 63]
    assert by_name["features.pool3"]["output_shape"] == [1, 64, 31]
    assert by_name["features.flatten"]["output_shape"] == [1, 64]
    assert by_name["rr_branch.relu"]["output_shape"] == [1, 16]
    assert by_name["concat"]["output_shape"] == [1, 80]
    assert by_name["head.fc2"]["output_shape"] == [1, 5]
    assert by_name["rr_branch.bn"]["type"] == "BatchNorm1d"
    assert layers[-1]["name"] == "head.fc2"

    dumped = json.dumps({"layers": layers, "total_params": count_parameters(model)})
    assert json.loads(dumped)["layers"] == layers


def test_describe_does_not_change_state(model):
    model.eval()
    x = torch.randn(3, 252)
    before = model(x).detach().clone()
    describe_architecture(model)
    assert torch.equal(before, model(x))
