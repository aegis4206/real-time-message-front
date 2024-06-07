import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'
import quasarOptions from './quasarOptions'
import { Quasar } from 'quasar';


const app = createApp(App)
app.use(Quasar, quasarOptions)

app.mount('#app')

