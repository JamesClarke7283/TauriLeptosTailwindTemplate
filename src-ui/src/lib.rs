use futures::StreamExt;
use leptos::prelude::*;
use serde::{Deserialize, Serialize};
use tauri_wasm::api::core::invoke;
use tauri_wasm::api::event;

#[derive(Serialize)]
struct GreetCmdArgs {
    name: String,
}

#[derive(Serialize)]
struct EmitEventCmdArgs {
    num: u16,
}

#[derive(Debug, Deserialize)]
struct GreetEventRes {
    greeting: String,
}

#[derive(Clone, PartialEq, Eq, Debug, Deserialize)]
pub struct GenericEventRes {
    num: u16,
    message: String,
}

async fn greet(name: String) -> String {
    invoke("greet", &GreetCmdArgs { name })
        .await
        .unwrap()
}

async fn listen_on_greet_event() -> String {
    let event = event::once::<GreetEventRes>("greet-event").await.unwrap();
    log::debug!("Received greet-event {:#?}", event);
    event.payload.greeting
}

async fn emit_generic_event(num: u16) {
    invoke::<_, ()>("emit_event", &EmitEventCmdArgs { num })
        .await
        .unwrap();
}

async fn listen_on_generic_event(event_writer: WriteSignal<Vec<GenericEventRes>>) {
    let mut events = event::listen::<GenericEventRes>("generic-event")
        .await
        .unwrap();

    while let Some(event) = events.next().await {
        log::debug!("Received generic-event {:#?}", event);
        event_writer.update(|all_events| all_events.push(event.payload));
    }
}

#[component]
pub fn Counter(value: ReadSignal<i32>, set_value: WriteSignal<i32>) -> impl IntoView {
    view! {
        <div class="flex items-center space-x-4 p-4"> 
            <button 
                on:click=move |_| set_value.set(0) 
                class="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md"
            >
                "Clear"
            </button>
            <button 
                on:click=move |_| set_value.update(|value| *value -= 1) 
                class="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-md"
            >
                "-1"
            </button>
            <span class="text-xl font-bold">
                "Value: " {move || value.get().to_string()} "!"
            </span>
            <button
                on:click=move |_| set_value.update(|value| *value += 1) 
                class="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md"
            >
                "+1"
            </button>
        </div>
    }
}


#[component]
pub fn Greeting(msg: ReadSignal<String>, greet_event_msg: ReadSignal<String>) -> impl IntoView {
    view! {
        <div class="p-4"> 
            <p class="text-lg">{msg}</p>
            <p class="italic">{greet_event_msg}</p>
        </div>
    }
}


#[component]
pub fn GenericEvents(
    event_vec: ReadSignal<Vec<GenericEventRes>>,
    emit_event_action: Action<u16, ()>,
    event_counter: ReadSignal<u16>,
    set_event_counter: WriteSignal<u16>,
) -> impl IntoView {
    view! {
        <div class="p-6 border border-gray-200 rounded-md shadow-sm"> 
            <button 
                on:click=move |_| {
                    emit_event_action.dispatch(event_counter.get());
                    set_event_counter.set(event_counter.get() + 1);
                }
                class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md"
            >
                "Emit Generic Event"
            </button>

            <ul class="list-disc list-inside ml-6 mt-4"> 
                <For each=move || event_vec.get().clone() key=|e| e.num  children=move |e: GenericEventRes| {
                    view! {
                        <li class="my-2">{e.message.clone()}</li> 
                    }
                } />
            </ul>
        </div>
    }
}


#[component]
pub fn SimpleCounter(name: String) -> impl IntoView {
    let (value, set_value) = signal(0);
    // Greet event, will clean-up once event is received.
    let (greet_event_msg, set_greet_event_msg) =
        signal("No `greet-event` from Tauri.".to_string());
    let greet_event_resource = LocalResource::new(move || (), |_| listen_on_greet_event());
    let greet_event_msg_memo = Memo::new(move |_| {
        set_greet_event_msg.set(
            greet_event_resource
                .get()
                .unwrap_or("Waiting for `greet-event` from Tauri.".to_string()),
        );
    });Effect::new(move |_| greet_event_msg_memo);
    // Generic event, listening constantly.
    let (event_counter, set_event_counter) = signal(1u16);
    let (event_vec, set_event_vec) = signal::<Vec<GenericEventRes>>(vec![]);
    let emit_event_action = Action::new(|num: &u16| emit_generic_event(*num));
    LocalResource::new(move || set_event_vec, listen_on_generic_event);
    // Greet command response.
    let greet_resource = LocalResource::new(move || name.to_owned(), greet);
    let (msg, set_msg) = signal("".to_string());
    Effect::new(move |_| {
        set_msg.set(greet_resource.get().unwrap_or_else(|| "".to_string()));
    });

    view! {
        <div class="container mx-auto max-w-md p-8 bg-white rounded-lg shadow-md"> 
            <Counter value=value set_value=set_value />
            <Greeting msg=msg greet_event_msg=greet_event_msg />
            <GenericEvents event_vec=event_vec emit_event_action=emit_event_action event_counter=event_counter set_event_counter=set_event_counter />
        </div>
    }
}
