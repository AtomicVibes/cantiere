import { supabase } from './supabase';

export const handleAssignProject = async (formData) => {
  try {
    if (!formData.job_title || formData.job_title === "") {
      alert("Please assign a job title to the user before adding them to a project.");
      return;
    }

    const { data, error } = await supabase
      .from('project_members')
      .insert([formData]);

    if (error) {
      console.error("Supabase Database Error:", error);
      alert("An unexpected error occurred. Please try again later.");
    } else {
      alert("User successfully assigned to project!");
    }
    
  } catch (err) {
    console.error("Unexpected Application Error:", err);
  }
};
