use leptos::prelude::*;
use src_ui::*;

pub fn main() {
    _ = console_log::init_with_level(log::Level::Debug);
    console_error_panic_hook::set_once();
    mount_to_body(|| view! {  <SimpleCounter name="Michal".to_string() /> })
}
