import sys
import subprocess

try:
    import onnx
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "onnx"])
    import onnx

from onnx import helper, TensorProto

X = helper.make_tensor_value_info('images', TensorProto.FLOAT, [1, 3, 224, 224])
Y = helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, 224, 224])

node_def = helper.make_node(
    'Identity',
    ['images'],
    ['output']
)

graph_def = helper.make_graph(
    [node_def],
    'dummy-model',
    [X],
    [Y],
)

model_def = helper.make_model(graph_def, producer_name='pharmacy-mvp')
onnx.save(model_def, 'public/models/dummy.onnx')
print("Successfully created public/models/dummy.onnx")
