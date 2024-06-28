<script setup lang="ts">
import _ from 'lodash';
import { QBtn, QInput, QFile, QIcon, } from 'quasar';
import { reactive, ref, onUnmounted, nextTick, watch, } from 'vue';
import VueEasyLightbox from 'vue-easy-lightbox'

interface messageType {
  From: string,
  Type: string,
  Message: string,
  File: string,
  Id: string,
  List?: onlineListType[],
  To?: string,
  ToUser?: string
  RTCType?: string
}
interface onlineListType {
  Username: string,
  Uuid: string,
  Obs?: boolean,
}

const connectId = ref("")
const messages = reactive<messageType[]>([])
const wsState = ref(false)
const textBox = reactive({ userName: "", text: "" })

const socket = ref<WebSocket>()
const file = ref<File | null>(null)
const imgList = reactive<string[]>([])
const toggler = ref(false)
const currentNumber = ref(0)
const onlineList = ref<onlineListType[]>([])

const scrollContainer = ref<HTMLDivElement | null>(null)

const privateTargetInit: onlineListType = {
  Username: "",
  Uuid: ""
}
let privateTarget = reactive<onlineListType>(privateTargetInit)

onUnmounted(() => {
  disConnectHandle()
})

const sendMessageHandle = () => {
  if (textBox.text.trim() != '') {
    const messageRep: messageType = {
      Message: textBox.text,
      From: textBox.userName,
      Type: "message",
      File: '',
      Id: connectId.value,
      To: privateTarget.Uuid,
      ToUser: privateTarget.Username
    }
    socket.value!.send(JSON.stringify(messageRep));
    textBox.text = '';
  }
}

const sendFileHandle = _.debounce(() => {
  if (file) {
    const reader = new FileReader();
    reader.readAsDataURL(file.value!);

    reader.onloadend = () => {
      const messageRep: messageType = {
        Message: reader.result as string,
        From: textBox.userName,
        Type: "file",
        File: file.value!.name as string,
        Id: connectId.value,
        To: privateTarget.Uuid,
        ToUser: privateTarget.Username
      }

      socket.value!.send(JSON.stringify(messageRep));
      file.value = null;
    };
  }
}, 1000)

const connectHandle = _.debounce(() => {
  if (!wsState.value) {
    socket.value = new WebSocket(`wss://192.168.6.87:8005/?username=${textBox.userName}`)
    socket.value.onopen = function () {
      console.log("WebSocket connected.");
    };

    socket.value.onmessage = async function (event) {
      // console.log("接收", event);
      let data: messageType = JSON.parse(event.data)
      console.log("接收", data);
      if (data.File && data.File != "" && !data.Type.startsWith('image')) {
        const url = base64ToUrl(data.Message, data.Type)
        data.Message = url
      }

      if (data.Type.startsWith('image')) {
        imgList.push(data.Message)
      }

      if (data.Type == "id") {
        connectId.value = data.Id
        wsState.value = true
        data.Message = `取得連線ID:${data.Id}`

        // 處理mesh音訊
        console.log('mesh音訊');
        startVoiceShare()
      }

      if (data.Type == "connected" || data.Type == "disconnected") {
        const message = data.Type == "connected" ? ' 已連線...' : ' 已離線...'
        data.Message = data.From + message
        onlineList.value = data.List!

        // 連線判斷 是否有分享螢幕
        const obsUser = onlineList.value.filter(user => user.Obs)
        console.log(obsUser);
        if (obsUser.length == 1 && obsUser[0].Uuid == connectId.value) {

          if (data.Type == "connected") {
            console.log("主持人與新連線建立RTC");
            screenSharePcs[data.Id] = await createOfferHandle(data.Id, 'screen');
          } else if (data.Type == "disconnected" && screenSharePcs[data.Id]) {
            screenSharePcs[data.Id].close()
          }
        }

        if (data.Type == "disconnected" && voiceSharePcs[data.Id] && voiceStreamList[data.Id]) {
          // 從mixedVoice中清除已離線的
          voiceStreamList[data.Id].getTracks().forEach(track => {
            let mixedTrack = mixedVoice.value!.getTracks().find(t => t.id === track.id);
            if (mixedTrack) {
              mixedVoice.value!.removeTrack(mixedTrack);
            }
          });
          voiceSharePcs[data.Id].close()
          delete voiceSharePcs[data.Id];
          delete voiceStreamList[data.Id]
          // 處理再次連線 需重開聲音才有聲音
        }
      }


      if (data.Type == 'obs') {
        if (data.Id != connectId.value && data.Message == 'end') {
          remoteStream.value = null
          console.log("關閉遠端畫面");
          Object.keys(screenSharePcs).forEach(pc => screenSharePcs[pc].close())
          screenSharePcs = {}
        }
        data.Message = data.From + (data.Message == 'start' ? ' 開始分享畫面' : ' 停止分享畫面')
        onlineList.value = data.List!
      }

      if (data.Type != "answer" && data.Type != "offer" && data.Type != "candidate") {
        messages.push(data)
        scrollToBottom()
      }

      if (data.To == connectId.value) {
        rtcHandle(data)
      }
    };

    socket.value.onclose = function () {
      console.log("WebSocket closed.");
      wsState.value = false
      socket.value = undefined
      connectId.value = ""
    };
  }
}, 1000)

const disConnectHandle = _.debounce(() => {
  // 處理連線
  stopScreenShare();
  stopVoiceShare();
  resetDevice();
  privateTargetClearHandle();
  onlineList.value = []


  socket.value?.close();
}, 1000)

const base64ToUrl = (base64String: string, type: string) => {
  const binaryString = window.atob(base64String.split(',')[1]);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type });

  const url = window.URL.createObjectURL(blob);

  return url
}

const imgPreviewHandle = (currentImg: string) => {
  const index = imgList.findIndex(img => img == currentImg)
  currentNumber.value = index
  toggler.value = true
}


const scrollToBottom = () => {
  nextTick(() => {
    const container = scrollContainer.value
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  })
}

const privateTargetChangeHandle = (user: onlineListType) => {
  if (user.Uuid != connectId.value) {
    privateTarget.Username = user.Username
    privateTarget.Uuid = user.Uuid
  }
}
const privateTargetClearHandle = () => {
  privateTarget.Username = ""
  privateTarget.Uuid = ""
}


const handleEnter = (event: KeyboardEvent) => {
  if (!event.shiftKey) {
    sendMessageHandle();
  } else {

  }
}

watch(() => onlineList, () => {
  if (privateTarget.Uuid != "") {
    const index = onlineList.value.findIndex(user => user.Uuid == privateTarget.Uuid)
    if (index == -1) {
      privateTargetClearHandle()
    }
  }

}, { deep: true })


// 螢幕共享
// const RTCHost = ref(false)
const localVideo = ref<HTMLVideoElement | null>(null);
const remoteVideo = ref<HTMLVideoElement | null>(null);
let localStream = ref<MediaStream | null>(null);
let remoteStream = ref<MediaStream | null>(null);

let voiceStreamList = reactive<{ [key: string]: MediaStream }>({})
let voiceSharePcs: { [key: string]: RTCPeerConnection } = {}
let voiceRef = ref<HTMLAudioElement | null>(null);
let localVoice = ref<MediaStream | null>(null);
// let mixedVoice = ref<MediaStream | null>(null);
let mixedVoice = ref<MediaStream>(new MediaStream);

let screenSharePcs: { [key: string]: RTCPeerConnection } = {}

const volumeMuted = ref(false)
const micMuted = ref(false)


const startVoiceShare = async () => {
  try {
    console.log("取得mic");
    localVoice.value = await navigator.mediaDevices.getUserMedia({ audio: true });

    localVoice.value.getAudioTracks().forEach(track => {
      localVoice.value!.addTrack(track);
    });

    // onlineList.value.forEach(async user => {
    //   if (user.Uuid != connectId.value) {
    //     const pc = await createVoiceOfferHandle(user.Uuid);
    //     voiceSharePcs[user.Uuid] = pc
    //   }
    // })
    RTCHostHandle('voice');


  } catch (error) {
    console.error('Error accessing display media.', error);
  }
}

const startScreenShare = async () => {
  try {
    localStream.value = await navigator.mediaDevices.getDisplayMedia({ video: true });

    localStream.value.getVideoTracks().forEach(track => {
      localStream.value!.addTrack(track);
    });


    if (localVideo.value) {
      localVideo.value.srcObject = localStream.value;
    }

    // 更新List 主持人
    socket.value!.send(JSON.stringify({
      From: textBox.userName,
      Type: "obs",
      Message: 'start',
      To: '',
      Id: connectId.value,
    }));

    RTCHostHandle('screen')

  } catch (error) {
    console.error('Error accessing display media.', error);
  }
};

const mixedVoiceHandle = (stream: MediaStream) => {
  // Object.keys(voiceStreamList).forEach(voice => {
  //   voiceStreamList[voice].getTracks().forEach(track => {
  //     mixedVoice.value!.addTrack(track);
  //   });
  // })
  stream.getTracks().forEach(track => {
    if (!mixedVoice.value!.getTracks().includes(track)) {
      mixedVoice.value!.addTrack(track);
    }
  });
  if (voiceRef.value) {
    voiceRef.value.srcObject = mixedVoice.value;
  }
}

const createOfferHandle = async (Uuid: string, type: string) => {
  const pc = new RTCPeerConnection()

  if (type == 'screen') {
    localStream.value!.getTracks().forEach(track => {
      pc.addTrack(track, localStream.value!);
    });
  } else if (type == 'voice') {
    localVoice.value!.getTracks().forEach(track => {
      pc.addTrack(track, localVoice.value!);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate && socket.value) {
      socket.value.send(JSON.stringify({
        From: textBox.userName,
        Type: "candidate",
        Message: JSON.stringify(event.candidate),
        To: Uuid,
        Id: connectId.value,
        RTCType: type
      }));
    }
  };

  if (type == 'voice') {
    pc.ontrack = event => {
      console.log("offer方接收音訊");
      const voiceStream = event.streams[0];
      voiceStreamList[Uuid] = voiceStream;
      mixedVoiceHandle(voiceStream)
    };
  }

  const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);

  if (socket.value) {
    socket.value.send(JSON.stringify({
      From: textBox.userName,
      Type: "offer",
      Message: JSON.stringify(offer),
      To: Uuid,
      Id: connectId.value,
      RTCType: type
    }));
  }
  return pc
}

const handleOffer = async (data: messageType) => {
  const pc = new RTCPeerConnection()

  if (data.RTCType == 'voice') {
    localVoice.value!.getTracks().forEach(track => {
      pc.addTrack(track, localVoice.value!);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate && socket.value) {
      socket.value.send(JSON.stringify({
        From: textBox.userName,
        Type: "candidate",
        Message: JSON.stringify(event.candidate),
        To: data.Id,
        Id: connectId.value,
        RTCType: data.RTCType
      }));
    }
  };

  if (data.RTCType == 'screen') {
    pc.ontrack = event => {
      remoteStream.value = event.streams[0];
      if (remoteVideo.value) {
        remoteVideo.value.srcObject = event.streams[0];
      }
    };
  } else if (data.RTCType == 'voice') {
    pc.ontrack = event => {
      console.log("answer方接收音訊");
      const voiceStream = event.streams[0];
      voiceStreamList[data.Id] = voiceStream;
      mixedVoiceHandle(voiceStream)
    };
  }


  await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.Message)));
  const answer = await pc.createAnswer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
  await pc.setLocalDescription(answer);

  if (socket.value) {
    socket.value.send(JSON.stringify({
      From: textBox.userName,
      Type: "answer",
      Message: JSON.stringify(answer),
      To: data.Id,
      Id: connectId.value,
      RTCType: data.RTCType
    }));
  }

  if (data.RTCType == 'screen') {
    screenSharePcs[data.Id] = pc
  } else if (data.RTCType == 'voice') {
    voiceSharePcs[data.Id] = pc
  }
};

const stopScreenShare = () => {
  if (localStream.value) {
    const tracks = localStream.value.getTracks();
    tracks.forEach((track) => track.stop());
    localStream.value = null;

    // 更新List 主持人
    socket.value!.send(JSON.stringify({
      From: textBox.userName,
      Type: "obs",
      Message: 'end',
      To: '',
      Id: connectId.value,
    }));
  }
  if (Object.keys(screenSharePcs).length > 0) {
    Object.keys(screenSharePcs).forEach(pc => screenSharePcs[pc].close())
    screenSharePcs = {}
  }
};

const stopVoiceShare = () => {
  if (localVoice.value) {
    const tracks = localVoice.value.getTracks();
    tracks.forEach((track) => track.stop());
    localVoice.value = null;

  }
  if (Object.keys(voiceSharePcs).length > 0) {
    Object.keys(voiceSharePcs).forEach(pc => voiceSharePcs[pc].close())
    voiceSharePcs = {}
  }
};

const rtcHandle = async (data: messageType) => {
  // console.log('rtc', data);

  switch (data.Type) {
    case "offer":
      console.log("接收offfer");
      await handleOffer(data)
      console.log("建立pc");
      break;
    case "candidate":
      console.log("回傳ice");
      if (data.RTCType == 'screen') {
        screenSharePcs[data.Id] && await screenSharePcs[data.Id].addIceCandidate(new RTCIceCandidate(JSON.parse(data.Message)));
      } else if (data.RTCType == 'voice') {
        voiceSharePcs[data.Id] && await voiceSharePcs[data.Id].addIceCandidate(new RTCIceCandidate(JSON.parse(data.Message)));
      }
      break;
    case "answer":
      console.log("回傳answer");
      if (data.RTCType == 'screen') {
        screenSharePcs[data.Id] && await screenSharePcs[data.Id].setRemoteDescription(new RTCSessionDescription(JSON.parse(data.Message)));
      } else if (data.RTCType == 'voice') {
        voiceSharePcs[data.Id] && await voiceSharePcs[data.Id].setRemoteDescription(new RTCSessionDescription(JSON.parse(data.Message)));
      }
      break;
    default:
      return
  }
}

const RTCHostHandle = (type: string) => {
  onlineList.value.forEach(async user => {
    if (user.Uuid != connectId.value) {
      const pc = await createOfferHandle(user.Uuid, type);
      if (type == 'screen') {
        screenSharePcs[user.Uuid] = pc
      } else if (type == 'voice') {
        voiceSharePcs[user.Uuid] = pc
      }
    }
  })
}

const volumeToggler = () => {
  volumeMuted.value = !volumeMuted.value
}

const micToggler = () => {
  micMuted.value = !micMuted.value
  if (localVoice.value) {
    localVoice.value.getAudioTracks().forEach(track => {
      track.enabled = !micMuted.value;
    })
  }
}

const resetDevice = () => {
  micMuted.value = false;
  volumeMuted.value = false;
}

const test = () => {
  console.log(voiceStreamList);
}

</script>

<template>
  <div class="md:max-h-screen md:min-h-screen flex flex-col md:flex-row">
    <div class="w-full md:border-r-4 md:max-h-screen md:w-1/4 bg-lime-100">
      <div class="row border-b-4 h-1/5 p-2">
        <div class="w-full mb-4 md:mb-0">
          <q-input maxlength="10" :disable="wsState" label="Name" type="text" v-model="textBox.userName" class="w-full"
            style="display: inline-block;" stack-label />
        </div>
        <div class="mb-4 md:mb-0">
          <q-btn :disable="wsState || textBox.userName == ''" type="button" color="positive"
            @click="connectHandle">連線</q-btn>
          <q-btn :disable="!wsState" type="button" color="red-5" style="margin-left: 10px"
            @click="disConnectHandle">離線</q-btn>
        </div>
      </div>
      <div class="overflow-y-auto h-4/5 4 border-b-4 md:border-b-0 p-2">
        <div class="flex justify-between">
          <div>在線清單</div>
          <div @click="privateTargetClearHandle" class="text-rose-500 cursor-pointer" v-if="privateTarget.Uuid != ''">
            <q-icon name="highlight_off" />
            私訊模式:{{ privateTarget.Username }}
          </div>
        </div>
        <template v-for="user in onlineList">
          <div class="cursor-pointer border-t-2" @click="privateTargetChangeHandle(user)">{{ user.Obs ?
            `${user.Username}
            (主持人)`: user.Username }}
          </div>
        </template>
      </div>
    </div>

    <div class="w-full md:w-3/4 md:max-h-screen">
      <div ref="scrollContainer" class="border-b-4 md:h-3/4 overflow-y-auto bg-sky-300 p-2">
        <div v-if="textBox.userName == ''" class="text-red">
          請輸入名字後點擊連線
        </div>
        <div v-for="message in messages">
          <div class="flex justify-between">
            <div
              v-if="(message.Id == connectId) && (message.Type != 'connected' && message.Type != 'disconnected' && message.Type != 'id' && message.Type != 'obs')">
            </div>
            <div :class="message.To != '' ? 'text-rose-500' : ''">
              <div v-if="message.Type == 'message'">
                {{ `${(message.Id == connectId && message.To != '' ? `私訊${message.ToUser} : ` : '')}
                ${message.Id == connectId ? '' : (message.From + " : ")}
                ${message.Message} `
                }}
              </div>
              <div class="text-fuchsia-700"
                v-else-if="message.Type == 'connected' || message.Type == 'disconnected' || message.Type == 'id' || message.Type == 'obs'">
                {{ `系統公告 : ${message.Message}` }}
              </div>
              <div v-else-if="message.Type.startsWith('image')">
                <div>
                  {{ `${(message.Id == connectId && message.To != '' ? `私訊${message.ToUser} : ` : '')}
                  ${message.Id == connectId ? '' : (message.From + " : ")}` }}
                  <img :src="message.Message" alt="" style="height: 200px;width: 200px;"
                    @click.native="imgPreviewHandle(message.Message)">
                </div>
              </div>
              <div v-else>
                <div>
                  {{ `${(message.Id == connectId && message.To != '' ? `私訊${message.ToUser} : ` : '')}
                  ${message.Id == connectId ? '' : (message.From + " : ")}` }}
                  <a :href="message.Message" alt="" target="_blank" :download="message.File">{{ message.File }}</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex md:h-1/4">
        <div class="w-full h-full md:w-1/2 bg-pink-200 outline-pink-400">
          <q-input :disabled="!wsState" class="p-2 bg-pink-200 outline-pink-400 mb-0.5" :disable="!wsState"
            :label="connectId == '' ? '尚未連線' : 'message'" type="textarea" v-model="textBox.text" placeholder="請輸入訊息"
            @keyup.enter="handleEnter" @keyup.enter.exact="sendMessageHandle" />
        </div>
        <div class="flex w-full flex-col md:w-1/2 justify-between p-2">
          <div class="flex mb-2 justify-between">
            <q-btn :disable="!wsState" color="primary" @click="sendMessageHandle">送出</q-btn>
            <q-btn :disabled="remoteStream || !wsState" @click="startScreenShare">分享畫面</q-btn>
            <q-btn :disabled="!localStream" @click="stopScreenShare">停止分享</q-btn>

          </div>

          <div class="flex">
            <q-btn :disabled="!wsState" flat round :icon="micMuted ? 'mic_off' : 'mic'" @click="micToggler" />
            <q-btn :disabled="!wsState" flat round :icon="volumeMuted ? 'volume_off' : 'volume_up'"
              @click="volumeToggler" />
            <!-- <q-slider style="width: 45%;" :min="0" :max="100" color="green" label-always /> -->
          </div>

          <div class="flex justify-between">
            <q-file class="w-2/3" :disable="connectId == ''" color="teal" label="選擇檔案" filled v-model="file">
              <template v-slot:prepend>
                <q-icon name="cloud_upload" />
              </template>
            </q-file>
            <q-btn class="w-1/3" :disable="!file || connectId == ''" type="button" color="accent"
              @click="sendFileHandle">上傳</q-btn>
          </div>
          <!-- <div v-if="connectId" class="text-xs">連線ID : {{ connectId }}</div> -->
        </div>
      </div>
    </div>
  </div>
  <vue-easy-lightbox :visible="toggler" :imgs="imgList" :index="currentNumber"
    @hide="() => toggler = false"></vue-easy-lightbox>
  <video v-show="localStream" ref="localVideo" autoplay muted></video>
  <video v-show="remoteStream" ref="remoteVideo" autoplay></video>
  <audio style="display: none;" ref="voiceRef" autoplay :muted="volumeMuted"></audio>
  <!-- <q-btn @click="test">111112222</q-btn> -->
</template>

<style scoped></style>
