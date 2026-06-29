exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  const ENDPOINT = "https://ark.ap-southeast-1.bytepluses.com/api/v3/contents/generations/tasks";

  if (!BYTEPLUS_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key not configured." }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { prompt, duration, mediaItems } = body;

    if (!prompt) {
      return { statusCode: 400, body: JSON.stringify({ error: "Prompt is required." }) };
    }

    const content = [{ type: "text", text: prompt }];

    const payload = {
      model: "dreamina-seedance-2-0-260128",
      content,
      generate_audio: true,
      ratio: "9:16",
      duration: duration || 15,
      watermark: false,
    };

    const submitRes = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BYTEPLUS_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      return {
        statusCode: submitRes.status,
        body: JSON.stringify({ error: submitData.message || JSON.stringify(submitData) }),
      };
    }

    const taskId = submitData?.data?.task_id || submitData?.task_id || submitData?.id;

    if (!taskId) {
      return { statusCode: 500, body: JSON.stringify({ error: "No task ID returned.", raw: submitData }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
