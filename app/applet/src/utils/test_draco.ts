import DracoEncoderModule from 'three/examples/jsm/libs/draco/draco_encoder.js';
import DracoDecoderModule from 'three/examples/jsm/libs/draco/draco_decoder.js';

async function test() {
  console.log("Encoder:", typeof DracoEncoderModule);
  console.log("Decoder:", typeof DracoDecoderModule);
}
test();
