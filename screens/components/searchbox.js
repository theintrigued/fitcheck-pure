import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Navbar from "./navbar";
import styles from "./searchbox.style";
import Swiper from "react-native-swiper";

import {
  reset,
  setIsLoggedIn,
  setUserEmail,
  setCurrentUsername,
  setFollowers,
  setFollowing,
  setFitcheckArray,
} from "../../reducers/user";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SearchBox({ navigation }) {
  //Redux Store data
  const dispatch = useDispatch();
  const {
    isLoggedIn,
    currentusername,
    fullname,
    followers,
    following,
    fitcheckArray,
  } = useSelector((state) => state.user);

  const [searchInput, setSearchInput] = useState(null);
  const [userResults, setUserResults] = useState(null);
  const [fitcheckResults, setFitcheckResults] = useState(null);
  const [listingResults, setListingResults] = useState(null);

  const fetchSearchResults = async () => {
    const formData = {
      params: searchInput,
      username: currentusername,
    };
    await fetch(
      "http://192.168.1.30:3000/search" || "http://192.168.1.30:3000/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      }
    )
      .then((response) => {
        return response.json();
      })
      .then((data) => {
        setUserResults(data.users);
        setFitcheckResults(data.fitchecks);
        setListingResults(data.listings);
      })
      .catch((error) => {
        console.error(error);
      });
  };

  useEffect(() => {
    fetchSearchResults();
  }, [searchInput]);

  const renderUserResults = () => {
    const userArray = userResults.map((item) => item.username);
    console.log(userArray);
    return (
      <View>
        <Text>Users:</Text>
        {userArray.map((username, index) => {
          return (
            <View style={{ marginVertical: 10 }}>
              <TouchableOpacity onPress={() => handleUserPress(username)}>
                <Text>{username}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  const handleUserPress = (username) => {
    const formData = {
      username: username,
    };
    fetch(
      "http://192.168.1.30:3000/getUser" || "http://192.168.1.30:3000/getUser",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      }
    )
      .then((response) => {
        return response.json();
      })
      .then((data) => {
        navigation.navigate("OtherUserProfile", { otherUser: data.user });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const renderFitcheckResults = () => {
    const fitcheckArray = fitcheckResults.map((item) => item.caption);
    console.log(fitcheckArray);
    return (
      <View>
        <Text>Fitchecks:</Text>
        {fitcheckArray.map((caption, index) => {
          return <Text>{caption}</Text>;
        })}
      </View>
    );
  };

  const renderListingResults = () => {
    const listingArray = listingResults.map((item) => item.name);
    console.log(listingArray);
    return (
      <View>
        <Text>Listings:</Text>
        {listingArray.map((name, index) => {
          return <Text>{name}</Text>;
        })}
      </View>
    );
  };

  return (
    <View style={{ ...styles.searchStyles }}>
      <View style={{ ...styles.content }}>
        <TextInput
          style={styles.loginInput}
          placeholder="Search"
          placeholderTextColor="#999"
          onChangeText={setSearchInput}
          value={searchInput}
        />
        {userResults ? renderUserResults() : ""}
        {fitcheckResults ? renderFitcheckResults() : ""}
        {listingResults ? renderListingResults() : ""}
      </View>
    </View>
  );
}
