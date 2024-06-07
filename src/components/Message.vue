<script setup lang="ts">
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
}
interface onlineListType {
  Username: string,
  Uuid: string
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
  if (textBox.text != '') {
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

const sendFileHandle = () => {
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
}

const connectHandle = () => {
  if (!wsState.value) {
    socket.value = new WebSocket(`ws://192.168.6.87:8005/?username=${textBox.userName}`)
    socket.value.onopen = function (event) {
      console.log("WebSocket connected.");
    };

    socket.value.onmessage = function (event) {
      let data: messageType = JSON.parse(event.data)
      // console.log("接收", data);
      if (data.File && data.File != "" && !data.Type.startsWith('image')) {
        const url = base64ToUrl(data.Message, data.Type)
        data.Message = url
      }

      if (data.Type.startsWith('image')) {
        imgList.push(data.Message)
      }

      if (data.Type == "connected" || data.Type == "disconnected") {

        if (!wsState.value && data.Type == "connected") {
          connectId.value = data.Id
        }

        wsState.value = true
        // console.log(data);
        data.Message = `${data.From} ${data.Type == 'connected' ? '已連線' : '已離線'}...`
        onlineList.value = data.List!
      }

      messages.push(data)
      scrollToBottom()
    };

    socket.value.onclose = function (event) {
      console.log("WebSocket closed.");
      wsState.value = false
      socket.value = undefined
      connectId.value = ""
    };
  }
}

const disConnectHandle = () => {
  socket.value?.close()
}

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
            @click="connectHandle">connet</q-btn>
          <q-btn :disable="!wsState" type="button" color="red-5" style="margin-left: 10px"
            @click="disConnectHandle">disconnect</q-btn>
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
          <div class="cursor-pointer border-t-2" @click="privateTargetChangeHandle(user)">{{ user.Username }}</div>
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
            <div v-if="(message.Id == connectId) && (message.Type != 'connected' && message.Type != 'disconnected')">
            </div>
            <div :class="message.To != '' ? 'text-rose-500' : ''">
              <div v-if="message.Type == 'message'">
                {{ `${(message.Id == connectId && message.To != '' ? `私訊${message.ToUser} : ` : '')}
                ${message.Id == connectId ? '' : (message.From + " : ")}
                ${message.Message} `
                }}
              </div>
              <div class="text-fuchsia-700" v-else-if="message.Type == 'connected' || message.Type == 'disconnected'">
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
      <div class="flex md:h-1/4 ">
        <q-input :disabled="!wsState" class="w-full md:h-auto md:w-2/3 p-2 bg-pink-200 outline-pink-400 mb-0.5"
          :disable="!wsState" :label="connectId == '' ? '尚未連線' : 'message'" type="textarea" v-model="textBox.text"
          style="display: inline-block;" placeholder="請輸入訊息" @keyup.enter="handleEnter"
          @keyup.enter.exact="sendMessageHandle" />
        <div class="flex flex-col mt-2 md:mt-0 md:w-1/3 md:pl-4 justify-between p-2">
          <div class="flex mb-2 justify-between">
            <q-btn :disable="!wsState" color="primary" @click="sendMessageHandle">send</q-btn>
            <q-btn :disable="!file || connectId == ''" type="button" color="accent"
              @click="sendFileHandle">sendFile</q-btn>
          </div>
          <div>
            <q-file :disable="connectId == ''" color="teal" label="Upload File" filled v-model="file">
              <template v-slot:prepend>
                <q-icon name="cloud_upload" />
              </template>
            </q-file>
          </div>
          <div v-if="connectId" class="text-xs">連線ID : {{ connectId }}</div>
        </div>
      </div>
    </div>
    <vue-easy-lightbox :visible="toggler" :imgs="imgList" :index="currentNumber"
      @hide="() => toggler = false"></vue-easy-lightbox>
  </div>
</template>

<style scoped></style>
